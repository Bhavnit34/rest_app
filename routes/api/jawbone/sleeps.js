// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
var api = require('./api');
var loggerModule = require('../../logger');
let request = require('request');
// AWS Dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();
var logger = loggerModule.getLogger();

router.get('/test', function(req,res){
    res.send('sleeps working');
    logger.info("logger working");
});

// function to return stored sleep data
router.get('/:userId/', function(req,res){
    var table = "Sleeps";
    var user_id = "";
    var returnJson = api.newReturnJson();
    var limit = 10;
    var attrValues = {};

    // check for passed userID
    if (!req.params.userId){
        returnJson.DynamoDB.message = "User ID missing!";
        returnJson.DynamoDB.error = true;
        return res.status(400).send(returnJson);
    } else {
        user_id = req.params.userId;
    }

    // authenticate token
    if (!req.query.token){
        returnJson.DynamoDB.message = "Token missing!";
        returnJson.DynamoDB.error = true;
        return res.status(401).send(returnJson);
    } else {
        var token = req.query.token;
    }

    // run this after authentication check below
    var proceed = function(authenticated) {

        if (authenticated == false) {
            returnJson.DynamoDB.message = "Authenication Failed";
            returnJson.DynamoDB.error = true;
            return res.status(401).send(returnJson);
        }


        // add limit to query if given
        if (req.query.limit) {
            if (!isNaN(req.query.limit)) {
                limit = parseInt(req.query.limit);
            } else {
                returnJson.DynamoDB.message = "Limit must be an integer";
                returnJson.DynamoDB.error = true;
                return res.status(400).send(returnJson);
            }
        }


        // add startDate to query if given
        var startDate = null;
        if (req.query.startDate) {
            if (!isNaN(Date.parse(req.query.startDate))) {
                startDate = req.query.startDate;
                var startStamp = new Date(startDate).getTime().toString().substr(0,10);
                attrValues[':startStamp'] = parseInt(startStamp);
            } else {
                returnJson.DynamoDB.message = "Invalid startDate";
                returnJson.DynamoDB.error = true;
                return res.status(400).send(returnJson);
            }
        }

        // add endDate to query if given
        var endDate = null;
        if (req.query.endDate) {
            if (!isNaN(Date.parse(req.query.endDate))) {
                // get the end of this day by getting the next day and minusing 1 off the UNIX timestamp
                endDate = req.query.endDate;
                var nextDate =  new Date(endDate);
                nextDate.setDate(nextDate.getDate() + 1);
                var endStamp = new Date(nextDate).getTime().toString().substr(0, 10);
                attrValues[':endStamp'] = parseInt(endStamp) - 1;
            } else {
                returnJson.DynamoDB.message = "Invalid endDate";
                returnJson.DynamoDB.error = true;
                return res.status(400).send(returnJson);
            }
        }


        // create query and append attributes if requested
        var query = "user_id = :user_id";
        attrValues[':user_id'] = user_id;
        if (startDate && endDate) {
            if(attrValues[':startStamp'] > attrValues[':endStamp']) {
                returnJson.DynamoDB.message = "endDate is before startDate!";
                returnJson.DynamoDB.error = true;
                return res.status(400).send(returnJson);
            }
            query += " AND timestamp_completed BETWEEN :startStamp AND :endStamp"; //results between dates
        } else if (startDate) {
            query += " AND timestamp_completed >= :startStamp"; // show dates going forwards from startDate
        } else if (endDate) {
            query += " AND timestamp_completed <= :endStamp"; // show dates going backwards from endDate
        }

        // Retrieve data from db
        var params = {
            TableName: table,
            KeyConditionExpression: query,
            ExpressionAttributeValues: attrValues,
            Limit: limit
        };


        docClient.query(params, function (err, data) {
            if (err) {
                logger.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                //console.log("GetItem succeeded:", JSON.stringify(data, null, 2));
                res.send(JSON.stringify(data, null, 2));
            }
        });
    };

    // continue only if token is authenticated
    api.authenticateToken(token, user_id, proceed);

});

// function to gather the latest data from Jawbone and push to DynamoDB
router.post('/updateSleeps', function(req,res_body){
    // make a jawbone REST request for sleeps info
    var path = '/nudge/api/v.1.1/users/@me/sleeps?';
    var returnJson = api.newReturnJson();


    // authenticate token
    if (!req.body.token){
        returnJson.Jawbone.message = "Token missing!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    }

    // add date to query if given
    if (req.body.date){
        if (req.body.date.toString().match(/^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/)) { //match YYYYMMDD
            path += "&date=" + req.body.date;
        } else {
            returnJson.Jawbone.message = "Please use date format YYYYMMDD";
            returnJson.Jawbone.error = true;
            return res_body.status(400).send(returnJson);
        }
    }

    // add limit to query if given
    if (req.body.limit) {
        if(typeof req.body.limit == "number") {
            path+= "&limit=" + parseInt(req.body.limit);
        } else {
            returnJson.Jawbone.message = "Limit must be an integer";
            returnJson.Jawbone.error = true;
            return res_body.status(400).send(returnJson);
        }
    }


    var options = {
        host: 'jawbone.com',
        path: path,
        headers: {'Authorization': 'Bearer ' + req.body.token},
        method: 'GET'
    };
    var body = "";
    var json_res = {};
    var req = https.request(options, function(res) {
        logger.debug('JAWBONE HTTP GET RESPONSE: ' + res.statusCode);

        res.on('data', function(d) {
            body += d;
        });
        res.on('end', function() {
            json_res = JSON.parse(body);
            if (res.statusCode != 200) {
                // REST response BAD, output error
                returnJson.Jawbone.message = JSON.stringify(json_res, null, 2);
                returnJson.Jawbone.error = true;
                return res_body.status(res.statusCode).send(returnJson);
            } else {
                json_res.data.items = api.clearEmptyItemStrings(json_res.data.items, json_res.data.size);
                for (var i = 0; i < json_res.data.size; i++) {
                    api.clearEmptyDataStrings(json_res.data.items[i].details);
                }
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                putSleeps();
            }


        });
        req.on('error', function(e) {
            logger.error(e);
            returnJson.Jawbone.message = e.message;
            returnJson.Jawbone.error = true;
            return res_body.status(500).send(returnJson);
        });
    });
    req.end();


    // Load sleeps info into db
    var putSleeps = function () {
        var table = "Sleeps";
        var user_id = json_res.meta.user_xid;
        var successCount = 0;


        // function to loop through each day and add/update the db row synchronously
        function updateDB(i){

            // handle when all items have been completed, set appropriate return values
            if (i >= json_res.data.size) {
                if (successCount == json_res.data.size) {
                    logger.info("All items added!");
                    returnJson.DynamoDB.message = "SUCCESS";
                    returnJson.DynamoDB.error = false;
                } else {
                    logger.error(successCount + "/" + json_res.data.size + " items updated.");
                    returnJson.DynamoDB.message = successCount + "/" + json_res.data.size + " items updated. See logs.";
                    returnJson.DynamoDB.error = true;
                }

                const end = json_res.data.size - 1;
                askAboutSleep(json_res.data.items[end], user_id, function(success, msg) {
                    returnJson.Telegram.error = success;
                    returnJson.Telegram.message = msg;

                    let code = 200;
                    if (returnJson.Telegram.error == true || returnJson.Telegram.error == true ||
                        returnJson.Telegram.error == true) {
                        code = 500;
                    }

                    return res_body.status(code).send(returnJson);


                });

                return;
            }

            // set unique table parameters
            let date = json_res.data.items[i].date.toString();
            const params = {
                TableName: table,
                Key: {
                    "user_id": user_id,
                    "timestamp_completed": json_res.data.items[i].time_completed,
                },
                UpdateExpression: "set #date = :date, info = :info",
                ExpressionAttributeValues: {
                    ":date" : date.substr(0,4) + "/" + date.substr(4,2) + "/" + date.substr(6,2),
                    ":info": json_res.data.items[i]
                },
                ExpressionAttributeNames: {
                    "#date" : "date"
                }
            };

            // update table
            logger.info("Adding sleep " + (i+1) + " --> " +  date + " for user " + user_id);
            docClient.update(params, function (err, data) {
                if (err) {
                    logger.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                    returnJson.DynamoDB[json_res.data.items[i].date.toString()] = JSON.stringify(err, null, 2);
                } else {
                    ++successCount;
                }
                updateDB(i+1); // call update for next row
            });

        }

        // start at the first index, the function will iterate over all indexes synchronously until complete and return.
        updateDB(0);

    };


});

function checkMoodExists(userID, timestamp, callback) {
    const params = {
        TableName : "Sleeps",
        Key: {
            "user_id" : userID,
            "timestamp_completed" : timestamp
        }
    };

    docClient.get(params, function(err, data) {
        if (err) {
            logger.error("checkMoodExists() : Unable to read Sleep item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            const sleep = data.Item;
            if (sleep.mood != null){
                logger.info("returning true");
            } else {
                logger.info("returning false");
            }
        }
    });
}

// function to determine if the user has recently woken up and if so, ask about their sleep using Telegram
function askAboutSleep(sleep, userID, callback) {
    // first ensure the mood doesn't already exist
    checkMoodExists(userID, sleep.time_completed, function(exists) {
        if (exists) {
            return callback(false, "The user has already given us their sleep summary");
        } else {
            ask();
        }
    });

    let ask = function() {
        logger.info("Checking if the user has recently awoken...");
        let activeTime = 0;
        const awakeTime = new Date(sleep.details.awake_time * 1000);
        const now = new Date();
        const wokenHour = api.pad(awakeTime.getHours(), 2);


        // check that the user woke up at most 2 hours ago
        if (now.getTime() - awakeTime.getTime() <= 7200000) {
            // now check that the user has been recently active, to ensure they are actually awake
            // we will check their recent Moves info for active time

            let today = new Date();
            today.setHours(0, 0, 0, 0);
            const query = "user_id = :user_id and timestamp_completed > :timestamp";
            const attrValues = {
                ":timestamp": parseInt(today.getTime().toString().substr(0, 10)),
                ":user_id": userID

            };
            // Retrieve data from db
            const params = {
                TableName: "Moves",
                KeyConditionExpression: query,
                ExpressionAttributeValues: attrValues,
                Limit: 1
            };


            docClient.query(params, function (err, data) {
                if (err) {
                    logger.error("askAboutSleep() : Unable to read Moves item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    const move = data;

                    // find correct hour to query active_time from
                    let hour = api.pad(now.getHours(), 2).toString();
                    const date = api.pad(now.getDate(), 2).toString();
                    let month = now.getMonth() + 1;
                    month = api.pad(month, 2).toString();
                    const year = now.getFullYear();

                    while (hour >= wokenHour) {
                        hour = api.pad(hour, 2).toString();
                        const hourlyString = year + month + date + hour;
                        // check it exists
                        if (move.Items[0].info.details.hourly_totals[hourlyString]) {
                            activeTime = move.Items[0].info.details.hourly_totals[hourlyString].active_time;
                            break;
                        } else {
                            hour--;
                        }
                    }

                    // now check active time; by this point the user woke up at most 2 hours ago
                    if (activeTime >= 50) {
                        logger.info("User is currently active. Asking about their sleep...");
                        // the user is awake and active. Ask about their sleep
                        telegramRequest(userID, function (error, msg) {
                            return callback(error, msg); // send the function result to the caller
                        });
                    } else {
                        const msg = "The user may not be awake. We won't ask them about their sleep. (active time = " + activeTime + ")";
                        logger.info(msg);
                        // We don't want to ask the user about their sleep at this point
                        return callback(false, msg);
                    }
                }
            });

        } else {
            const msg = "The user has not recently awoken. They last awoke at " + awakeTime.toString().split(" ").slice(0, 5).join(" ");
            logger.info(msg);
            // We don't want to ask the user about their sleep at this point
            return callback(false, msg);
        }
    }

}

// send a message to the users chat
function telegramRequest(userID, callback) {
    api.getbotDetails(userID, function(botDetails) {
        const now = new Date();
        const day = api.pad(now.getDate(),2).toString();
        let month = now.getMonth() + 1;
        month = api.pad(month, 2).toString();
        const year = now.getFullYear();
        const date = year + "/" + month + "/" + day;

        const json = { "chat_id" : botDetails.chat_id,
            "text" : "I've noticed you're awake. How well did you sleep?",
            "force_reply" : "True",
            "reply_markup": {"inline_keyboard": [
                [
                    {"text" : "\uD83D\uDE01", "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 5, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE0A", "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 4, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE0C", "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 3, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE14", "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 2, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE2B", "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 1, \"date\": \"" + date + "\"}"}
                ]
            ]}
        };

        request({
            url: 'https://api.telegram.org/bot' + botDetails.botAPI + '/' + 'sendMessage',
            method: "POST",
            json: json,
            headers: { "content-type" : "application/json"}
        }, function(err, res, body){
            let msg = "";
            if(err) {
                msg = 'telegramRequest :  problem with request: ' + err.message;
                logger.error(msg);
                return callback(true, msg);
            }
            msg = "A sleep request message has been sent to the user";
            logger.info("telegramRequest : " + msg);
            return callback(false, msg)
        });
    });

}




// function to calculate the stats from the whole table, if these values were lost
function calculateInitialStats(userID, callback) {
    let AwakeTime = {avg : 0, total : 0, totalCount : 0, avgCount : 0};
    let AsleepTime = {avg : 0,  total : 0, totalCount : 0, avgCount : 0};
    let Light = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};
    let REM = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};
    let Deep = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};
    let Duration = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};

    const table = "Sleeps";
    const params = {
        TableName: table,
        KeyConditionExpression: "user_id = :user_id",
        ExpressionAttributeValues: {":user_id" : userID}

    };

    docClient.query(params, function(err, data) {
        if (err) {
            logger.error("Unable to read Sleep item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            // proceed to calculating the stats
            Light.min = data.Items[0].info.details.light;
            Light.max = data.Items[0].info.details.light;
            REM.max = data.Items[0].info.details.rem;
            REM.min = data.Items[0].info.details.rem;
            Deep.min = data.Items[0].info.details.sound;
            Deep.max = data.Items[0].info.details.sound;
            Duration.min = data.Items[0].info.details.duration;
            Duration.max = data.Items[0].info.details.duration;

            for(let i = 0; i < data.Items.length; i++) {
                // loop through each row and cumulate the average

                /*
                 calculate time in seconds, we don't want the whole timestamp
                 for this we are using the time relative to midnight (i.e. 00:00)
                 23:00 would be -3600 seconds, 01:00 would be +3600
                 */

                // awake time
                let awake = data.Items[i].info.details.awake_time;
                if (awake != null) {
                    let awakeDate = new Date(awake * 1000);
                    let awakeStart = new Date(awake * 1000);
                    awakeStart.setHours(0,0,0,0);
                    let awake_time = ((awakeDate.getTime() - awakeStart.getTime()) / 1000);
                    // i.e. make negative if later than midday, by deducting from midnight
                    if (awake_time > 43200) {awake_time = awake_time - 86400;}
                    AwakeTime.totalCount++;
                    AwakeTime.total += awake_time;
                }

                // asleep time
                let asleep = data.Items[i].info.details.asleep_time;
                if (asleep != null) {
                    // calculate time in seconds, we don't want the whole timestamp
                    let asleepDate = new Date(asleep * 1000);
                    let asleepStart = new Date(asleep * 1000);
                    asleepStart.setHours(0,0,0,0);
                    let asleep_time = ((asleepDate.getTime() - asleepStart.getTime()) / 1000);
                    // i.e. make negative if later than midday, by deducting from midnight
                    if (asleep_time > 43200) {asleep_time = asleep_time - 86400;}
                    AsleepTime.totalCount++;
                    AsleepTime.total += asleep_time;
                }

                // light
                let light = data.Items[i].info.details.light;
                if (light != null) {
                    Light.totalCount++;
                    Light.total += light;
                    if (light < Light.min) {
                        Light.min = light;
                    } else if (light > Light.max) {
                        Light.max = light;
                    }
                }

                // rem
                let rem = data.Items[i].info.details.rem;
                if (rem != null) {
                    REM.totalCount++;
                    REM.total += rem;
                    if (rem < REM.min) {
                        REM.min = rem;
                    } else if (rem > REM.max) {
                        REM.max = rem;
                    }
                }

                // deep
                let deep = data.Items[i].info.details.sound;
                if (deep != null) {
                    Deep.totalCount++;
                    Deep.total += deep;
                    if (deep < Deep.min) {
                        Deep.min = deep;
                    } else if (deep > Deep.max) {
                        Deep.max = deep;
                    }
                }

                // duration
                let duration = data.Items[i].info.details.duration;
                if (duration != null) {
                    Duration.totalCount++;
                    Duration.total += duration;
                    if (duration < Duration.min) {
                        Duration.min = duration;
                    } else if (duration > Duration.max) {
                        Duration.max = duration;
                    }
                }



            }

            // calculate averages
            AwakeTime.avg = Math.ceil(AwakeTime.total / AwakeTime.totalCount);
            AsleepTime.avg = Math.ceil(AsleepTime.total / AsleepTime.totalCount);
            Light.avg = Math.ceil(Light.total / Light.totalCount);
            REM.avg = Math.ceil(REM.total / REM.totalCount);
            Deep.avg = Math.ceil(Deep.total / Deep.totalCount);
            Duration.avg = Math.ceil(Duration.total / Duration.totalCount);

            const timestamp_updated = Date.now().toString().substr(0,10);

            let stats = {
                AwakeTime : {
                    avg: AwakeTime.avg,
                    avg_count: AwakeTime.totalCount,
                    timestamp_updated: timestamp_updated
                },
                AsleepTime : {
                    avg: AsleepTime.avg,
                    avg_count: AsleepTime.totalCount,
                    timestamp_updated: timestamp_updated
                },
                Light : {
                    avg: Light.avg,
                    min: Light.min,
                    max: Light.max,
                    avg_count: Light.totalCount,
                    timestamp_updated: timestamp_updated
                },
                REM : {
                    avg: REM.avg,
                    min: REM.min,
                    max: REM.max,
                    avg_count: REM.totalCount,
                    timestamp_updated: timestamp_updated
                },
                Deep : {
                    avg: Deep.avg,
                    min: Deep.min,
                    max: Deep.max,
                    avg_count: Deep.totalCount,
                    timestamp_updated: timestamp_updated
                },
                Duration : {
                    avg: Duration.avg,
                    min: Duration.min,
                    max: Duration.max,
                    avg_count: Duration.totalCount,
                    timestamp_updated: timestamp_updated
                }

            };

            return callback(stats);
        }

    });
}


// function to update the stats table (totals and averages)
router.post('/updateStats', function(req, res) {
    let user_id = "";
    let returnJson = api.newReturnJson();
    let token = "";
    let newStats = {
        AwakeTime: {avg: 0, avg_count: 0, timestamp_updated: 0},
        AsleepTime: {avg: 0, avg_count: 0, timestamp_updated: 0},
        Light: {min: 0, max: 0, avg: 0, avg_count: 0, timestamp_updated: 0},
        REM: {min: 0, max: 0, avg: 0, avg_count: 0, timestamp_updated: 0},
        Deep: {min: 0, max: 0, avg: 0, avg_count: 0, timestamp_updated: 0},
        Duration: {min: 0, max: 0, avg: 0, avg_count: 0, timestamp_updated: 0}
    };

    // check userId
    if (!req.body.userId) {
        returnJson.Jawbone.message = "Missing userId!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    } else {
        user_id = req.body.userId;
    }

    // authenticate token
    if (!req.body.token) {
        returnJson.Jawbone.message = "Token missing!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    } else {
        token = req.body.token;
    }

    // continue only if token is authenticated
    api.authenticateToken(token, user_id, function (authenticated) {
        if (!authenticated) {
            returnJson.Jawbone.message = "Authentication Failed!";
            returnJson.Jawbone.error = true;
            return res_body.status(401).send(returnJson);
        }

        let checkStats = function (callback) {
            // read what we currently have in the stats table
            const table = "Stats";
            const params = {
                TableName: table,
                KeyConditionExpression: "user_id = :user_id",
                ExpressionAttributeValues: {":user_id": user_id}

            };
            docClient.query(params, function (err, data) {
                if (err) {
                    logger.error("Unable to read STATS Sleeps item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    let sleep = data.Items[0].info.Sleep;
                    // to speed up checking for null, check for the string ":null" in the json
                    let temp = JSON.stringify(data.Items[0].info.Sleep, null, 2);
                    let jsonString = temp.replace(/ /g, ''); // trim all whitespace
                    if (jsonString.indexOf(":null") > -1) {
                        // we need to restore the stats
                        logger.info("Sleep Stats not in table. Updating...");
                        calculateInitialStats(user_id, function (res) {
                            return callback(res);
                        });
                    } else {
                        logger.info("Checking for new Sleep values to update the stats...");
                        // update the stats if there are new items in the DB since last update
                        const params = {
                            TableName: "Sleeps",
                            KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
                            ExpressionAttributeValues: {
                                ":user_id": user_id,
                                ":timestamp": sleep.AwakeTime.timestamp_updated
                            }
                        };

                        docClient.query(params, function (err, data) {
                            if (err) {
                                logger.error("Unable to read Sleep item. Error JSON:", JSON.stringify(err, null, 2));
                            } else {
                                if (data.AwakeTime == 0) {
                                    return callback(null);
                                } // don't write any stats if there are no updates
                                // calculate new stats by taking into account the new values
                                const row = data.Items;
                                // use these so we don't include null Sleeps in the averaging
                                let AwakeTime = {total: 0, totalCount: 0};
                                let AsleepTime = {total: 0, totalCount: 0};
                                let Light = {total: 0, totalCount: 0};
                                let REM = {total: 0, totalCount: 0};
                                let Deep = {total: 0, totalCount: 0};
                                let Duration = {total: 0, totalCount: 0};


                                // assign local min/max to what we currently have in the stats table
                                newStats.Light.max = sleep.Light.max;
                                newStats.Light.min = sleep.Light.min;
                                newStats.REM.max = sleep.REM.max;
                                newStats.REM.min = sleep.REM.min;
                                newStats.Deep.max = sleep.Deep.max;
                                newStats.Deep.min = sleep.Deep.min;
                                newStats.Duration.max = sleep.Duration.max;
                                newStats.Duration.min = sleep.Duration.min;

                                for (let i = 0; i < data.Items.length; i++) {
                                    // awake time
                                    let awake = row[i].info.details.awake_time;
                                    if (awake != null) {
                                        // calculate time in seconds, we don't want the whole timestamp
                                        let awakeDate = new Date(awake * 1000);
                                        let awakeStart = new Date(awake * 1000);
                                        awakeStart.setHours(0,0,0,0);
                                        let awake_time = ((awakeDate.getTime() - awakeStart.getTime()) / 1000);
                                        // i.e. make negative if later than midday, by deducting from midnight
                                        if (awake_time > 43200) {awake_time = awake_time - 86400;}

                                        AwakeTime.totalCount++;
                                        AwakeTime.total += awake_time;
                                    }

                                    // asleep time
                                    let asleep = row[i].info.details.asleep_time;
                                    if (asleep != null) {
                                        // calculate time in seconds, we don't want the whole timestamp
                                        let asleepDate = new Date(asleep * 1000);
                                        let asleepStart = new Date(asleep * 1000);
                                        asleepStart.setHours(0,0,0,0);
                                        let asleep_time = ((asleepDate.getTime() - asleepStart.getTime()) / 1000);
                                        // i.e. make negative if later than midday, by deducting from midnight
                                        if (asleep_time > 43200) {asleep_time = asleep_time - 86400;}
                                        AsleepTime.totalCount++;
                                        AsleepTime.total += asleep_time;
                                    }

                                    // light
                                    let light = row[i].info.details.light;
                                    if (light != null) {
                                        Light.totalCount++;
                                        if (light > newStats.Light.max) {
                                            newStats.Light.max = light;
                                        } else if (light < newStats.Light.min) {
                                            newStats.Light.min = light;
                                        }
                                        Light.total += light;
                                    }

                                    // REM
                                    let rem = row[i].info.details.rem;
                                    if (rem != null) {
                                        REM.totalCount++;
                                        if (rem > newStats.REM.max) {
                                            newStats.REM.max = rem;
                                        } else if (rem < newStats.REM.min) {
                                            newStats.REM.min = rem;
                                        }
                                        REM.total += rem;
                                    }

                                    // Deep
                                    let deep = row[i].info.details.sound;
                                    if (deep != null) {
                                        Deep.totalCount++;
                                        if (deep > newStats.Deep.max) {
                                            newStats.Deep.max = deep;
                                        } else if (deep < newStats.Deep.min) {
                                            newStats.Deep.min = deep;
                                        }
                                        Deep.total += deep;
                                    }

                                    // Duration
                                    let duration = row[i].info.details.duration;
                                    if (duration != null) {
                                        Duration.totalCount++;
                                        if (duration > newStats.Duration.max) {
                                            newStats.Duration.max = duration;
                                        } else if (duration < newStats.Duration.min) {
                                            newStats.Duration.min = duration;
                                        }
                                        Duration.total += duration;
                                    }



                                }
                                // calculate new average by adding on the new values and dividng by (total + no. of new values)
                                // awake time
                                newStats.AwakeTime.avg = Math.ceil(((sleep.AwakeTime.avg * sleep.AwakeTime.avg_count) + AwakeTime.total) / (sleep.AwakeTime.avg_count + AwakeTime.totalCount));
                                newStats.AwakeTime.avg_count = sleep.AwakeTime.avg_count + AwakeTime.totalCount;
                                newStats.AwakeTime.timestamp_updated = Date.now().toString().substr(0, 10);
                                // asleep time
                                newStats.AsleepTime.avg = Math.ceil(((sleep.AsleepTime.avg * sleep.AsleepTime.avg_count) + AsleepTime.total) / (sleep.AsleepTime.avg_count + AsleepTime.totalCount));
                                newStats.AsleepTime.avg_count = sleep.AsleepTime.avg_count + AsleepTime.totalCount;
                                newStats.AsleepTime.timestamp_updated = Date.now().toString().substr(0, 10);
                                // light sleep
                                newStats.Light.avg = Math.ceil(((sleep.Light.avg * sleep.Light.avg_count) + Light.total) / (sleep.Light.avg_count + Light.totalCount));
                                newStats.Light.avg_count = sleep.Light.avg_count + Light.totalCount;
                                newStats.Light.timestamp_updated = Date.now().toString().substr(0, 10);
                                // REM sleep
                                newStats.REM.avg = Math.ceil(((sleep.REM.avg * sleep.REM.avg_count) + REM.total) / (sleep.REM.avg_count + REM.totalCount));
                                newStats.REM.avg_count = sleep.REM.avg_count + REM.totalCount;
                                newStats.REM.timestamp_updated = Date.now().toString().substr(0, 10);
                                // Deep sleep
                                newStats.Deep.avg = Math.ceil(((sleep.Deep.avg * sleep.Deep.avg_count) + Deep.total) / (sleep.Deep.avg_count + Deep.totalCount));
                                newStats.Deep.avg_count = sleep.Deep.avg_count + Deep.totalCount;
                                newStats.Deep.timestamp_updated = Date.now().toString().substr(0, 10);
                                // Duration sleep
                                newStats.Duration.avg = Math.ceil(((sleep.Duration.avg * sleep.Duration.avg_count) + Duration.total) / (sleep.Duration.avg_count + Duration.totalCount));
                                newStats.Duration.avg_count = sleep.Duration.avg_count + Duration.totalCount;
                                newStats.Duration.timestamp_updated = Date.now().toString().substr(0, 10);

                                return callback(newStats);
                            }
                        });
                    }
                }
            });
        };

        // function that will write in the stats decided by checkStats()
        checkStats(function (stats) {
            // end if there is nothing to update
            if (stats == null) {
                logger.info("Sleep Stats already up to date");
                updateWeeklyStats(weeklyStatsCallback);
                return;
            }


            // otherwise update the Stats table
            const params = {
                TableName: "Stats",
                Key: {"user_id": user_id},
                UpdateExpression: "set info.Sleep.AwakeTime.#avg = :AwakeTime_avg," +
                " info.Sleep.AwakeTime.avg_count = :AwakeTime_avg_count," +
                " info.Sleep.AwakeTime.timestamp_updated = :AwakeTime_timestamp_updated," +

                " info.Sleep.AsleepTime.#avg = :AsleepTime_avg," +
                " info.Sleep.AsleepTime.avg_count = :AsleepTime_avg_count," +
                " info.Sleep.AsleepTime.timestamp_updated = :AsleepTime_timestamp_updated," +

                " info.Sleep.Light.#avg = :Light_avg," +
                " info.Sleep.Light.#min = :Light_min," +
                " info.Sleep.Light.#max = :Light_max," +
                " info.Sleep.Light.avg_count = :Light_avg_count," +
                " info.Sleep.Light.timestamp_updated = :Light_timestamp_updated," +

                " info.Sleep.REM.#avg = :REM_avg," +
                " info.Sleep.REM.#min = :REM_min," +
                " info.Sleep.REM.#max = :REM_max," +
                " info.Sleep.REM.avg_count = :REM_avg_count," +
                " info.Sleep.REM.timestamp_updated = :REM_timestamp_updated," +

                " info.Sleep.Deep.#avg = :Deep_avg," +
                " info.Sleep.Deep.#min = :Deep_min," +
                " info.Sleep.Deep.#max = :Deep_max," +
                " info.Sleep.Deep.avg_count = :Deep_avg_count," +
                " info.Sleep.Deep.timestamp_updated = :Deep_timestamp_updated," +

                " info.Sleep.#Duration.#avg = :Duration_avg," +
                " info.Sleep.#Duration.#min = :Duration_min," +
                " info.Sleep.#Duration.#max = :Duration_max," +
                " info.Sleep.#Duration.avg_count = :Duration_avg_count," +
                " info.Sleep.#Duration.timestamp_updated = :Duration_timestamp_updated",


                ExpressionAttributeValues: {
                    // awake time
                    ":AwakeTime_avg_count": stats.AwakeTime.avg_count,
                    ":AwakeTime_avg": stats.AwakeTime.avg,
                    ":AwakeTime_timestamp_updated": parseInt(stats.AwakeTime.timestamp_updated),

                    // asleep time
                    ":AsleepTime_avg_count": stats.AsleepTime.avg_count,
                    ":AsleepTime_avg": stats.AsleepTime.avg,
                    ":AsleepTime_timestamp_updated": parseInt(stats.AsleepTime.timestamp_updated),

                    // light
                    ":Light_min": stats.Light.min,
                    ":Light_max": stats.Light.max,
                    ":Light_avg_count": stats.Light.avg_count,
                    ":Light_avg": stats.Light.avg,
                    ":Light_timestamp_updated": parseInt(stats.Light.timestamp_updated),

                    // REM
                    ":REM_min": stats.REM.min,
                    ":REM_max": stats.REM.max,
                    ":REM_avg_count": stats.REM.avg_count,
                    ":REM_avg": stats.REM.avg,
                    ":REM_timestamp_updated": parseInt(stats.REM.timestamp_updated),

                    // deep
                    ":Deep_min": stats.Deep.min,
                    ":Deep_max": stats.Deep.max,
                    ":Deep_avg_count": stats.Deep.avg_count,
                    ":Deep_avg": stats.Deep.avg,
                    ":Deep_timestamp_updated": parseInt(stats.Deep.timestamp_updated),

                    // duration
                    ":Duration_min": stats.Duration.min,
                    ":Duration_max": stats.Duration.max,
                    ":Duration_avg_count": stats.Duration.avg_count,
                    ":Duration_avg": stats.Duration.avg,
                    ":Duration_timestamp_updated": parseInt(stats.Duration.timestamp_updated)
                },
                ExpressionAttributeNames: {
                    "#avg": "avg",
                    "#min": "min",
                    "#max": "max",
                    "#Duration" : "Duration"
                },
                ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result

            };

            // update dynamo table
            docClient.update(params, function (err, data) {
                if (err) {
                    logger.error("Error updating Stats Sleep table. Error JSON:", JSON.stringify(err, null, 2));
                    returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                    returnJson.DynamoDB.error = true;
                    return res.status(500).send(returnJson);
                } else {
                    logger.info("Sleep Stats updated!");
                    // move onto updating the weekly stats
                    updateWeeklyStats(weeklyStatsCallback);
                }
            });

        });

        function updateWeeklyStats(callback) {
            logger.info("Calculating weeklyStats for Sleep...");
            // firstly calculate the latest Sunday
            const table = "WeeklyStats";
            let sunday = new Date();
            sunday.setHours(0, 0, 0, 0);
            while (sunday.getDay() != 0) { // 0 = Sunday
                sunday.setTime(sunday.getTime() - 86400000); // i.e. minus one day
            }
            let date = parseInt(sunday.getTime().toString().substr(0, 10));
            let fullDate = new Date(date * 1000);
            let dateString = fullDate.toString().split(" ").slice(0,4).join(" ") + " (" + date + ")";

            const params = {
                TableName: table,
                KeyConditionExpression: "user_id = :user_id AND timestamp_weekStart >= :timestamp_weekStart",
                ExpressionAttributeValues: {
                    ":user_id": user_id,
                    ":timestamp_weekStart": date
                }
            };

            // query WeeklyStats if this Sunday exists
            docClient.query(params, function (err, data) {
                if (err) {
                    logger.error("Error reading " + table + " table. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    // to speed up checking for null, check for the string ":null" in the json
                    let temp = JSON.stringify(data.Items[0].info.Sleep);
                    let jsonString = temp.replace(/ /g, ''); // trim all whitespace

                    if (data.AwakeTime > 0 && jsonString.indexOf(":null") == -1) {
                        // There already is an entry for this week
                        const msg = "There already exists an entry for Sleep in week : " + dateString;
                        logger.info(msg);
                        return callback(true, msg);
                    } else {
                        returnWeeksAverage(user_id, date, function (Averages) {
                            if (Averages == null) {
                                return callback(false, "error in getting average for week starting: " + dateString);
                            }
                            // now store or update the calculated weekly average into the WeeklyStats table
                            let params = {};

                            if (data.AwakeTime > 0) { // update the row that exists
                                logger.info("Updating WeeklyStats row that already exists...");

                                const params = {
                                    TableName: table,
                                    Key: {
                                        "user_id": user_id,
                                        "timestamp_weekStart": date
                                    },
                                    UpdateExpression: "set info.Sleep.AwakeTime.#avg = :AwakeTime_avg," +
                                    " info.Sleep.AsleepTime.#avg = :AsleepTime_avg," +
                                    " info.Sleep.Light.#avg = :Light_avg," +
                                    " info.Sleep.REM.#avg = :REM_avg," +
                                    " info.Sleep.Deep.#avg = :Deep_avg," +
                                    " info.Sleep.#Duration.#avg = :Duration_avg",

                                    ExpressionAttributeValues: {
                                        ":AwakeTime_avg": Averages.AwakeTime,
                                        ":AsleepTime_avg": Averages.AsleepTime,
                                        ":Light_avg": Averages.Light,
                                        ":REM_avg": Averages.REM,
                                        ":Deep_avg": Averages.Deep,
                                        ":Duration_avg": Averages.Duration

                                    },
                                    ExpressionAttributeNames: {
                                        "#avg": "avg",
                                        "#Duration" : "Duration"
                                    },
                                    ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result
                                };

                                // update dynamo table
                                docClient.update(params, function (err, data) {
                                    if (err) {
                                        const msg = "Error updating WeeklyStats Sleep table. Error JSON: " + JSON.stringify(err, null, 2);
                                        logger.error(msg);
                                        return callback(false, msg);
                                    } else {
                                        const msg = "WeeklyStats row with week: " + dateString + " updated";
                                        logger.info(msg);
                                        return callback(true, msg);
                                    }
                                });

                            } else { // create a new row as it doesn't exist
                                logger.info("Creating new WeeklyStats row...");
                                let json = api.newWeeklyStatsJson();
                                json.Sleep.AwakeTime.avg = Averages.AwakeTime;
                                json.Sleep.AsleepTime.avg = Averages.AsleepTime;
                                json.Sleep.Light.avg = Averages.Light;
                                json.Sleep.REM.avg = Averages.REM;
                                json.Sleep.Deep.avg = Averages.Deep;
                                json.Sleep.Duration.avg = Averages.Duration;
                                params = {
                                    TableName: table,
                                    Item: {
                                        "user_id": user_id,
                                        "timestamp_weekStart": date,
                                        "info": json
                                    }
                                };

                                docClient.put(params, function (err, data) {
                                    let msg = "";
                                    if (err) {
                                        msg = "Error writing to " + table + " table. Error JSON: " + JSON.stringify(err, null, 2);
                                        logger.error(msg);
                                        return callback(false, msg);
                                    } else {
                                        msg = "New row added to WeeklyStats for week starting: " + dateString;
                                        logger.debug(msg);
                                        return callback(true, msg);
                                    }
                                });

                            }
                        });
                    }

                }
            });

            // function to take a Sleep week block and return its average
            let returnWeeksAverage = function(user_id, date, callback) {
                logger.info("Calculating average Sleep for week: " + date + "...");
                const params = {
                    TableName: "Sleeps",
                    KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
                    ExpressionAttributeValues: {
                        ":user_id": user_id,
                        ":timestamp": date
                    },
                    Limit: 7
                };

                docClient.query(params, function(err, data) {
                    if (err) {
                        logger.error("Error reading Sleeps table. Error JSON:", JSON.stringify(err, null, 2));
                    } else {
                        if (data.AwakeTime < 1) {
                            return callback(null)
                        } else {
                            // use these so we don't include the null items in the averaging
                            let AwakeTime = {total: 0, totalCount: 0};
                            let AsleepTime = {total: 0, totalCount: 0};
                            let Light = {total: 0, totalCount: 0};
                            let REM = {total: 0, totalCount: 0};
                            let Deep = {total: 0, totalCount: 0};
                            let Duration = {total: 0, totalCount: 0};

                            for (let i = 0; i < data.Items.length; i++) {
                                let sleep = data.Items[i].info;
                                if (sleep == null) { continue ;}

                                // awake time
                                let awake = sleep.details.awake_time;
                                if (awake != null) {
                                    // calculate time in seconds, we don't want the whole timestamp
                                    let awakeDate = new Date(awake * 1000);
                                    let awakeStart = new Date(awake * 1000);
                                    awakeStart.setHours(0,0,0,0);
                                    let awake_time = ((awakeDate.getTime() - awakeStart.getTime()) / 1000);
                                    // i.e. make negative if later than midday, by deducting from midnight
                                    if (awake_time > 43200) {awake_time = awake_time - 86400;}

                                    AwakeTime.total += awake_time;
                                    AwakeTime.totalCount++;
                                }

                                // asleep time
                                let asleep = sleep.details.asleep_time;
                                if (asleep != null) {
                                    // calculate time in seconds, we don't want the whole timestamp
                                    let asleepDate = new Date(asleep * 1000);
                                    let asleepStart = new Date(asleep * 1000);
                                    asleepStart.setHours(0,0,0,0);
                                    let asleep_time = ((asleepDate.getTime() - asleepStart.getTime()) / 1000);
                                    // i.e. make negative if later than midday, by deducting from midnight
                                    if (asleep_time > 43200) {asleep_time = asleep_time - 86400;}

                                    AsleepTime.total += asleep_time;
                                    AsleepTime.totalCount++;
                                }

                                // light sleep
                                if (sleep.details.light != null) {
                                    Light.total += sleep.details.light;
                                    Light.totalCount++;
                                }

                                // REM sleep
                                if (sleep.details.rem != null) {
                                    REM.total += sleep.details.rem;
                                    REM.totalCount++;
                                }

                                // Deep sleep
                                if (sleep.details.sound != null) {
                                    Deep.total += sleep.details.sound;
                                    Deep.totalCount++;
                                }

                                // Duration
                                if (sleep.details.duration != null) {
                                    Duration.total += sleep.details.duration;
                                    Duration.totalCount++;
                                }
                            }

                            // Calculate averages
                            let Averages = {AwakeTime: 0, AsleepTime: 0, Light: 0, REM: 0, Deep: 0, Duration: 0};
                            Averages.AwakeTime = Math.ceil(AwakeTime.total / AwakeTime.totalCount);
                            Averages.AsleepTime = Math.ceil(AsleepTime.total / AsleepTime.totalCount);
                            Averages.Light = Math.ceil(Light.total / Light.totalCount);
                            Averages.REM = Math.ceil(REM.total / REM.totalCount);
                            Averages.Deep = Math.ceil(Deep.total / Deep.totalCount);
                            Averages.Duration = Math.ceil(Duration.total / Duration.totalCount);

                            return callback(Averages);
                        }
                    }
                });
            }
        }

        // function that is called after weeklyStats to give an output message
        function weeklyStatsCallback(success, message) {
            const output = "Sleep weekly stats: " + message;
            if (success) {
                logger.info(output);
                returnJson.DynamoDB.message = output;
                returnJson.DynamoDB.error = false;
                return res.status(200).send(returnJson);
            } else {
                logger.info(output);
                returnJson.DynamoDB.message = output;
                returnJson.DynamoDB.error = true;
                return res.status(500).send(returnJson);
            }
        }
    });
});

module.exports = router;