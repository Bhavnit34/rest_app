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
    res.send('moves working');
    logger.info("new logger working");
});

// function to return stored moves data
router.get('/:userId/', function(req,res){
    var table = "Moves";
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
                console.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
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
router.post('/updateMoves', function(req,res_body){
    // make a jawbone REST request for moves info
    var path = '/nudge/api/v.1.1/users/@me/moves?';
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
                // REST response OK, proceed to DB update
                json_res.data.items = api.clearEmptyItemStrings(json_res.data.items, json_res.data.size);
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                putMoves();
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


    // Load moves info into db
    var putMoves = function () {
        var table = "Moves";
        var user_id = json_res.meta.user_xid;
        var successCount = 0;


        // function to loop through each day and add/update the db row synchronously
        function updateDB(i) {

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

                askAboutDay(json_res.data.items[0], user_id, function(error, msg) {
                    returnJson.Telegram.error = error;
                    returnJson.Telegram.message = msg;

                    let code = 200;
                    if (returnJson.DynamoDB.error == true || returnJson.Jawbone.error == true ||
                        returnJson.Telegram.error == true) {
                        code = 500;
                    }

                    return res_body.status(code).send(returnJson);


                });

                return;
            }

            // set unique table parameters
            var date = json_res.data.items[i].date.toString();
            var formattedDate = date.substr(0,4) + "/" + date.substr(4,2) + "/" + date.substr(6,2);
            var params = {
                TableName: table,
                Item: {
                    "user_id": user_id,
                    "timestamp_completed": json_res.data.items[i].time_completed,
                    "date": formattedDate,
                    "info": json_res.data.items[i]
                }
            };

            var updateCallback = function (){
                // update table
                logger.info("Adding moves " + (i+1) + " --> " +  date + " for user " + user_id);
                docClient.put(params, function (err, data) {
                    if (err) {
                        logger.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                    } else {
                        ++successCount;
                    }
                    updateDB(i+1);
                });
            };


            // delete any old data for the same day
            deleteOldData(table, formattedDate, user_id, updateCallback);


        }

        // start at the first index, the function will iterate over all indexes synchronously until complete and return.
        updateDB(0);

    }


});

// function to remove any old rows of a given day that are now out of date (given the update of new data)
function deleteOldData(table, date, user_id, updateCallback) {
    // query the table for current data on the given date
    var params = {
        TableName: table,
        KeyConditionExpression: 'user_id = :user_id',
        FilterExpression: '#mydate = :date',
        ExpressionAttributeValues: {
            ':user_id': user_id,
            ':date': date
        },
        ExpressionAttributeNames: {
            "#mydate": "date"
        }
    };

    docClient.query(params, function(err, data) {
        if (err) {
            logger.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            var res = data;
            if (res.Count <= 0) {return updateCallback();} // return if there is no data to delete
            // now delete any data that exists for this day
            function deleteData(i, nextDeleteCallback) {
                var userId = res.Items[i].user_id;
                var timestamp = res.Items[i].timestamp_completed;
                var delParams = {
                    TableName: table,
                    Key: {
                        "user_id": userId,
                        "timestamp_completed": timestamp
                    }
                };
                docClient.delete(delParams, function (err, data) {
                    if (err) {
                        logger.error("Unable to delete item. Error JSON:", JSON.stringify(err, null, 2))
                    } else {
                        logger.debug("Deleted old data --> " + user_id + ", " + date);
                        return nextDeleteCallback();
                    }
                })
            }

            var i = 0;
            var nextDeleteCallback = function() {
                i++;
                if (i < res.Items.length) {
                    deleteData(i, nextDeleteCallback);
                } else {
                    // we have deleted all of the data for this day, return
                    return updateCallback();
                }
            };
            deleteData(i, nextDeleteCallback);


        }
    })


}


function checkMoodExists(userID, date, callback) {

    const params = {
        TableName : "DailyMood",
        Key: {
            "user_id" : userID,
            "date" : date
        },
    };

    docClient.get(params, function(err, data) {
        if (err) {
            logger.error("checkMoodExists() : Unable to read Move item. Error JSON:", JSON.stringify(err, null, 2));
            return callback(true, false); // error is true, exists is false
        } else {
            if (data.Count > 0) {
                return callback(false, true);
            } else {
                return callback(false, false);
            }
        }
    });
}

function getAwokenTime(userID, timestamp, callback) {
    const params = {
        TableName: "Sleeps",
        KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
        ExpressionAttributeValues: {":user_id" : userID, ":timestamp" : parseInt(timestamp)},
        Limit: 1
    };

    docClient.query(params, function(err, data) {
        if (err) {
            logger.error("getAwokenTime() : error reading Sleeps table. Error JSON: " + JSON.stringify(err, null, 2));
            return callback(null);
        }
        if (data.Count < 1) {
            return callback(null);
        }
        return callback(data.Items[0].info.details.awake_time);
    })
}

// function to determine if the user has recently woken up and if so, ask about their sleep using Telegram
function askAboutDay(move, userID, callback) {
    let date = move.date.toString();
    let formattedDate = date.substr(0,4) + "/" + date.substr(4,2) + "/" + date.substr(6,2);

    // first ensure the mood doesn't already exist
    checkMoodExists(userID, formattedDate, function(error, exists) {
        if (error) {return callback(true, "askAboutDay() : error reading mood");}
        if (exists) {
            const msg = "The user has already given us their day summary";
            logger.info(msg);
            return callback(false, msg);
        } else {
            ask();
        }
    });

    let ask = function() {
        logger.info("Checking if the time is right to ask about the users day...");
        const now = new Date();
        let msg = "";

        let midnight = new Date();
        midnight.setHours(0,0,0,0);
        let timestamp = midnight.getTime().toString().substr(0,10);

        // firstly find how long they are awake for on average
        const params = {
            TableName: "Stats",
            Key: {"user_id": userID},
        };

        // query Stats table for the users awake duration
        docClient.get(params, function(err, data) {
            if (err) {
                msg = "checkMoodExists() : Unable to read STATS item. Error JSON:" + JSON.stringify(err, null, 2);
                logger.error(msg);
                return callback(true, msg);
            }
            let awake_duration = data.Item.info.Sleep.AwakeDuration.avg;

            // now check that the time is about right to ask about their day
            const awake_hours = Math.round(awake_duration / 3600); // convert seconds to hours
            const target_hour = Math.round(awake_hours * 0.75); // set a target time of 3/4 into the day

            logger.info("User is awake for " + awake_hours + " hours. The target hour is therefore " + target_hour + " hours past awake time");
            getAwokenTime(userID, timestamp, function(awoken_time) {
                if (!awoken_time) {
                    msg = "askAboutDay() : time awoken is currently not available";
                    logger.info(msg);
                    return callback(false, msg);
                }

                let awakeDate = new Date(awoken_time * 1000);
                // add on 3/4 of a users day. This is our target start time to ask
                let targetDate = new Date(awakeDate.getTime() + (3600000 * target_hour));
                // get last hour to ask. This is when we guess the user will go to sleep, so don't ask after that.
                let lastDate = new Date(awakeDate.getTime() + (3600000 * awake_hours));

                logger.info ("The target Date is " + targetDate + ". The latest time to ask is at " + lastDate);
                logger.info("Checking that " + now.toString() + " >= " + targetDate.toString() + " && " + now.toString() + " <= " + lastDate.getHours());
                if ((now.getTime() >= targetDate.getTime()) && (now.getTime() <= lastDate.getTime())) {
                    // it is a suitable time to ask about the users day
                    // now we must check if they are not too busy, using recorded active time and steps
                    logger.info("We are in the right time slot");
                    const params = {
                        TableName : "Moves",
                        KeyConditionExpression : "user_id = :user_id AND timestamp_completed > :timestamp",
                        ExpressionAttributeValues : {":user_id" : userID, ":timestamp" : parseInt(timestamp)},
                        Limit: 1
                    };

                    // read Moves table and find recent active time and steps
                    docClient.query(params, function(err, data) {
                        if (err) {
                            msg = "askAboutDay() : error reading Moves table. Error JSON: " + JSON.stringify(err,null,2);
                            logger.error(msg);
                            return callback(true, msg);
                        }
                        if (data.Count < 1) {
                            msg = "askAboutDay() : There is no move data to query for today";
                            logger.info(msg);
                            return callback(false, msg);
                        }
                        let date = data.Items[0].date;
                        let dateString = date.substr(0,4) + date.substr(5,2) + date.substr(8,2);
                        let move = data.Items[0].info;
                        let hour = api.pad(now.getHours().toString(), 2);
                        let hourly_total = dateString + hour;
                        let active_time = -1;
                        let steps = -1;

                        // check current hour, and this is too recent, then check hour before
                        for (let i = 0; i < 2; i++) {
                            if (move.details.hourly_totals.hasOwnProperty(hourly_total)) {
                                active_time = move.details.hourly_totals[hourly_total].active_time;
                                steps = move.details.hourly_totals[hourly_total].steps;
                                logger.info("found moves info as : active_time = " + active_time + ", steps = " + steps);
                                break;
                            } else {
                                hour--;
                                hour = api.pad(hour, 2).toString();
                                hourly_total = dateString + hour;
                            }
                        }


                        if (active_time == -1 ) {
                            // we didn't find a recent stat about the users activity
                            msg = "Not enough information to make a decision about the users day";
                            logger.info(msg);
                            return callback(false, msg);
                        }

                        // finally check that they are not too busy, and if so send a Telegram request
                        if (active_time <= 100 || steps <= 150) {
                            logger.info("User is not busy. Asking about their day...");
                            // the user is active but not too busy
                            telegramRequest(userID, function (error, msg) {
                                return callback(error, msg); // send the function result to the caller
                            });
                        } else {
                            const msg = "The user seems to be busy. We won't ask about their day for now.";
                            logger.info(msg);
                            // We don't want to ask the user about their day at this point
                            return callback(false, msg);
                        }



                    });

                } else {
                    msg = "It's not the right time to ask about their day";
                    logger.info(msg);
                    // We don't want to ask the user about their day at this point
                    return callback(false, msg);
                } // end check for current time within window

            }); // end getAwokenTime() callback
        }); // end query of Stats table
    }; // end function ask()

}

// send a message to the users chat
function telegramRequest(userID, callback) {
    api.getbotDetails(userID, function(botDetails) {
        if (botDetails == null) { return callback(false, "We don't have the users Telegram info. No message has been sent");}

        const now = new Date();
        const day = api.pad(now.getDate(),2).toString();
        let month = now.getMonth() + 1;
        month = api.pad(month, 2).toString();
        const year = now.getFullYear();
        const date = year + "/" + month + "/" + day;

        const json = { "chat_id" : botDetails.chat_id,
            "text" : "How was your day today?",
            "force_reply" : "True",
            "reply_markup": {"inline_keyboard": [
                [
                    {"text" : "\uD83D\uDE01", "callback_data" : "{\"caller\": \"updateMoves\", \"mood\": 5, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE0A", "callback_data" : "{\"caller\": \"updateMoves\", \"mood\": 4, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE0C", "callback_data" : "{\"caller\": \"updateMoves\", \"mood\": 3, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE14", "callback_data" : "{\"caller\": \"updateMoves\", \"mood\": 2, \"date\": \"" + date + "\"}"},
                    {"text" : "\uD83D\uDE2B", "callback_data" : "{\"caller\": \"updateMoves\", \"mood\": 1, \"date\": \"" + date + "\"}"}
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
    let Steps = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};
    let Distance = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};
    let Calories = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};
    let ActiveTime = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};


    const table = "Moves";
    const params = {
        TableName: table,
        KeyConditionExpression: "user_id = :user_id",
        ExpressionAttributeValues: {":user_id" : userID}

    };

    docClient.query(params, function(err, data) {
        if (err) {
            logger.error("Unable to read Moves item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            // proceed to calculating the stats
            Steps.min = data.Items[0].info.details.steps;
            Steps.max = data.Items[0].info.details.steps;
            Distance.min = data.Items[0].info.details.distance;
            Distance.max = data.Items[0].info.details.distance;
            Calories.min = data.Items[0].info.details.calories;
            Calories.max = data.Items[0].info.details.calories;
            ActiveTime.max = data.Items[0].info.details.active_time;
            ActiveTime.min = data.Items[0].info.details.active_time;
            for(let i = 0; i < data.Items.length; i++) {
                // loop through each row and cumulate the average

                // steps
                let steps = data.Items[i].info.details.steps;
                if (steps != null) {
                    Steps.totalCount++;
                    Steps.total += steps;
                    if (steps < Steps.min) {
                        Steps.min = steps;
                    } else if (steps > Steps.max) {
                        Steps.max = steps;
                    }
                }

                // distance
                let distance = data.Items[i].info.details.distance;
                if (distance != null) {
                    Distance.totalCount++;
                    Distance.total += distance;
                    if (distance < Distance.min) {
                        Distance.min = distance;
                    } else if (distance > Distance.max) {
                        Distance.max = distance;
                    }
                }

                // calories
                let calories = data.Items[i].info.details.calories;
                if (calories != null) {
                    Calories.totalCount++;
                    Calories.total += calories;
                    if (calories < Calories.min) {
                        Calories.min = calories;
                    } else if (calories > Calories.max) {
                        Calories.max = calories;
                    }
                }

                // active time
                let activeTime = data.Items[i].info.details.active_time;
                if (activeTime != null) {
                    ActiveTime.totalCount++;
                    ActiveTime.total += activeTime;
                    if (activeTime < ActiveTime.min) {
                        ActiveTime.min = activeTime;
                    } else if (activeTime > ActiveTime.max) {
                        ActiveTime.max = activeTime;
                    }
                }



            }
            Steps.avg = Math.ceil(Steps.total / Steps.totalCount);
            Distance.avg = Math.ceil(Distance.total / Distance.totalCount);
            Calories.avg = Math.ceil(Calories.total / Calories.totalCount);
            ActiveTime.avg = Math.ceil(ActiveTime.total / ActiveTime.totalCount);
            const timestamp_updated = Date.now().toString().substr(0,10);

            let stats = {
                Steps : {
                    avg: Steps.avg,
                    min: Steps.min,
                    max: Steps.max,
                    avg_count: Steps.totalCount,
                    timestamp_updated: timestamp_updated
                },
                Distance : {
                    avg: Distance.avg,
                    min: Distance.min,
                    max: Distance.max,
                    avg_count: Distance.totalCount,
                    timestamp_updated: timestamp_updated
                },
                Calories : {
                    avg: Calories.avg,
                    min: Calories.min,
                    max: Calories.max,
                    avg_count: Calories.totalCount,
                    timestamp_updated: timestamp_updated
                },
                Time : {
                    avg: ActiveTime.avg,
                    min: ActiveTime.min,
                    max: ActiveTime.max,
                    avg_count: ActiveTime.totalCount,
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
    let newStats = {Steps:{min:0, max:0, avg:0, avg_count: 0, timestamp_updated: 0},
        Distance:{min:0, max:0, avg:0,avg_count: 0, timestamp_updated: 0},
        Calories:{min:0, max:0, avg:0,avg_count: 0, timestamp_updated: 0},
        ActiveTime:{min:0, max:0, avg:0,avg_count: 0, timestamp_updated: 0}};

    // check userId
    if (!req.body.userId){
        returnJson.Jawbone.message = "Missing userId!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    } else {
        user_id = req.body.userId;
    }

    // authenticate token
    if (!req.body.token){
        returnJson.Jawbone.message = "Token missing!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    } else {
        token = req.body.token;
    }

    // continue only if token is authenticated
    api.authenticateToken(token, user_id, function(authenticated) {
        if(!authenticated) {
            returnJson.Jawbone.message = "Authentication Failed!";
            returnJson.Jawbone.error = true;
            return res_body.status(401).send(returnJson);
        }

        let checkStats = function(callback) {
            // read what we currently have in the stats table
            const table = "Stats";
            const params = {
                TableName: table,
                KeyConditionExpression: "user_id = :user_id",
                ExpressionAttributeValues: {":user_id" : user_id}

            };
            docClient.query(params, function (err, data) {
                if (err) {
                    logger.error("Unable to read STATS Moves item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    let mv = data.Items[0].info.Moves;
                    // to speed up checking for null, check for the string ":null" in the json
                    let temp = JSON.stringify(data.Items[0].info.Moves, null, 2);
                    let jsonString = temp.replace(/ /g,''); // trim all whitespace
                    if (jsonString.indexOf(":null") > -1) {
                        // we need to restore the stats
                        logger.info("Moves Stats not in table. Updating...");
                        calculateInitialStats(user_id, function(res){
                            return callback(res);
                        });
                    } else {
                        logger.info("Checking for new Moves values to update the stats...");
                        // update the stats if there are new items in the DB since last update
                        const params = {
                            TableName: "Moves",
                            KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
                            ExpressionAttributeValues: {
                                ":user_id": user_id,
                                ":timestamp": mv.Steps.timestamp_updated
                            }
                        };

                        docClient.query(params, function (err, data) {
                            if (err) {
                                logger.error("Unable to read Moves item. Error JSON:", JSON.stringify(err, null, 2));
                            } else {
                                if(data.Count == 0) {return callback(null);} // don't write any stats if there are no updates
                                // calculate new stats by taking into account the new values
                                const row = data.Items;
                                // use these so we don't include null moves in the averaging
                                let Steps = { total: 0, totalCount : 0};
                                let Distance = { total: 0, totalCount : 0};
                                let Calories = { total: 0, totalCount : 0};
                                let ActiveTime = { total: 0, totalCount : 0};
                                // assign local min/max to what we currently have in the stats table
                                newStats.Steps.max = mv.Steps.max;
                                newStats.Steps.min = mv.Steps.min;
                                newStats.Distance.max = mv.Distance.max;
                                newStats.Distance.min = mv.Distance.min;
                                newStats.Calories.max = mv.Calories.max;
                                newStats.Calories.min = mv.Calories.min;
                                newStats.ActiveTime.max = mv.Active_time.max;
                                newStats.ActiveTime.min = mv.Active_time.min;

                                for (let i = 0; i < data.Items.length; i++) {
                                    // steps
                                    let steps = row[i].info.details.steps;
                                    if (steps != null) {
                                        Steps.totalCount++;
                                        if (steps > newStats.Steps.max) {
                                            newStats.Steps.max = steps;
                                        } else if (steps < newStats.Steps.min) {
                                            newStats.Steps.min = steps;
                                        }
                                        Steps.total += steps;
                                    }

                                    // distance
                                    let distance = row[i].info.details.distance;
                                    if (distance != null) {
                                        Distance.totalCount++;
                                        if (distance > newStats.Distance.max) {
                                            newStats.Distance.max = distance;
                                        } else if (distance < newStats.Distance.min) {
                                            newStats.Distance.min = distance;
                                        }
                                        Distance.total += distance;
                                    }

                                    // calories
                                    let calories = row[i].info.details.calories;
                                    if (calories != null) {
                                        Calories.totalCount++;
                                        if (calories > newStats.Calories.max) {
                                            newStats.Calories.max = calories;
                                        } else if (calories < newStats.Calories.min) {
                                            newStats.Calories.min = calories;
                                        }
                                        Calories.total += calories;
                                    }

                                    // active time
                                    let activeTime = row[i].info.details.active_time;
                                    if (activeTime != null) {
                                        ActiveTime.totalCount++;
                                        if (activeTime > newStats.ActiveTime.max) {
                                            newStats.ActiveTime.max = activeTime;
                                        } else if (activeTime < newStats.ActiveTime.min) {
                                            newStats.ActiveTime.min = activeTime;
                                        }
                                        ActiveTime.total += activeTime;
                                    }

                                }
                                // calculate new average by adding on the new values and dividng by (total + no. of new values)
                                // steps
                                newStats.Steps.avg = Math.ceil(((mv.Steps.avg * mv.Steps.avg_count) + Steps.total) / (mv.Steps.avg_count + Steps.totalCount));
                                newStats.Steps.avg_count = mv.Steps.avg_count + Steps.totalCount;
                                newStats.Steps.timestamp_updated = Date.now().toString().substr(0, 10);
                                // distance
                                newStats.Distance.avg = Math.ceil(((mv.Distance.avg * mv.Distance.avg_count) + Distance.total) / (mv.Distance.avg_count + Distance.totalCount));
                                newStats.Distance.avg_count = mv.Distance.avg_count + Distance.totalCount;
                                newStats.Distance.timestamp_updated = Date.now().toString().substr(0, 10);
                                // calories
                                newStats.Calories.avg = Math.ceil(((mv.Calories.avg * mv.Calories.avg_count) + Calories.total) / (mv.Calories.avg_count + Calories.totalCount));
                                newStats.Calories.avg_count = mv.Calories.avg_count + Calories.totalCount;
                                newStats.Calories.timestamp_updated = Date.now().toString().substr(0, 10);
                                // active time
                                newStats.ActiveTime.avg = Math.ceil(((mv.Active_time.avg * mv.Active_time.avg_count) + ActiveTime.total) / (mv.Active_time.avg_count + ActiveTime.totalCount));
                                newStats.ActiveTime.avg_count = mv.Active_time.avg_count + ActiveTime.totalCount;
                                newStats.ActiveTime.timestamp_updated = Date.now().toString().substr(0, 10);
                                return callback(newStats);
                            }
                        });
                    }
                }
            });
        };

        // function that will write in the stats decided by checkStats()
        checkStats(function(stats){
            // end if there is nothing to update
            if (stats == null) {
                logger.info("Moves Stats already up to date");
                updateWeeklyStats(weeklyStatsCallback);
                return;
            }



            // otherwise update the Stats table
            const params = {
                TableName:"Stats",
                Key:{"user_id": user_id},
                UpdateExpression: "set info.Moves.Steps.#avg = :steps_avg," +
                " info.Moves.Steps.#min = :steps_min," +
                " info.Moves.Steps.#max = :steps_max," +
                " info.Moves.Steps.avg_count = :steps_avg_count," +
                " info.Moves.Steps.timestamp_updated = :steps_timestamp_updated," +

                " info.Moves.Distance.#avg = :distance_avg," +
                " info.Moves.Distance.#min = :distance_min," +
                " info.Moves.Distance.#max = :distance_max," +
                " info.Moves.Distance.avg_count = :distance_avg_count," +
                " info.Moves.Distance.timestamp_updated = :distance_timestamp_updated," +

                " info.Moves.Calories.#avg = :calories_avg," +
                " info.Moves.Calories.#min = :calories_min," +
                " info.Moves.Calories.#max = :calories_max," +
                " info.Moves.Calories.avg_count = :calories_avg_count," +
                " info.Moves.Calories.timestamp_updated = :calories_timestamp_updated," +

                " info.Moves.Active_time.#avg = :activeTime_avg," +
                " info.Moves.Active_time.#min = :activeTime_min," +
                " info.Moves.Active_time.#max = :activeTime_max," +
                " info.Moves.Active_time.avg_count = :activeTime_avg_count," +
                " info.Moves.Active_time.timestamp_updated = :activeTime_timestamp_updated",
                ExpressionAttributeValues:{
                    // steps
                    ":steps_min": stats.Steps.min,
                    ":steps_max": stats.Steps.max,
                    ":steps_avg_count": stats.Steps.avg_count,
                    ":steps_avg": stats.Steps.avg,
                    ":steps_timestamp_updated" : parseInt(stats.Steps.timestamp_updated),

                    // distance
                    ":distance_min": stats.Distance.min,
                    ":distance_max": stats.Distance.max,
                    ":distance_avg_count": stats.Distance.avg_count,
                    ":distance_avg": stats.Distance.avg,
                    ":distance_timestamp_updated" : parseInt(stats.Distance.timestamp_updated),

                    // calories
                    ":calories_min": stats.Calories.min,
                    ":calories_max": stats.Calories.max,
                    ":calories_avg_count": stats.Calories.avg_count,
                    ":calories_avg": stats.Calories.avg,
                    ":calories_timestamp_updated" : parseInt(stats.Calories.timestamp_updated),

                    // active time
                    ":activeTime_min": stats.ActiveTime.min,
                    ":activeTime_max": stats.ActiveTime.max,
                    ":activeTime_avg_count": stats.ActiveTime.avg_count,
                    ":activeTime_avg": stats.ActiveTime.avg,
                    ":activeTime_timestamp_updated" : parseInt(stats.ActiveTime.timestamp_updated)
                },
                ExpressionAttributeNames: {
                    "#avg": "avg",
                    "#min": "min",
                    "#max": "max",
                },
                ReturnValues:"UPDATED_NEW" // give the resulting updated fields as the JSON result

            };

            // update dynamo table
            docClient.update(params, function(err, data) {
                if (err) {
                    logger.error("Error updating Stats Moves table. Error JSON:", JSON.stringify(err, null, 2));
                    returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                    returnJson.DynamoDB.error = true;
                    return res.status(500).send(returnJson);
                } else {
                    logger.info("Moves Stats updated!");
                    // move onto updating the weekly stats
                    updateWeeklyStats(weeklyStatsCallback);
                }
            });

        });

        function updateWeeklyStats(callback) {
            logger.info("Calculating weeklyStats for Moves...");
            // firstly calculate the latest Sunday
            const table = "WeeklyStats";
            let sunday = new Date();
            sunday.setHours(0,0,0,0);
            while (sunday.getDay() != 0) { // 0 = Sunday
                sunday.setTime(sunday.getTime() - 86400000); // i.e. minus one day
            }
            let date = parseInt(sunday.getTime().toString().substr(0,10));
            let fullDate = new Date(date * 1000);
            let dateString = fullDate.toString().split(" ").slice(0,4).join(" ") + " (" + date + ")";

            const params = {
                TableName: table,
                KeyConditionExpression: "user_id = :user_id AND timestamp_weekStart >= :timestamp_weekStart",
                ExpressionAttributeValues: {
                    ":user_id" : user_id,
                    ":timestamp_weekStart" : date
                }
            };

            // query WeeklyStats if this Sunday exists
            docClient.query(params, function(err, data) {
                if (err) {
                    logger.error("Error reading " + table + " table. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    returnWeeksAverage(user_id, date, function (Averages) {
                        if (Averages == null) {
                            return callback(false, "error in getting average for week starting: " + dateString)
                        }
                        // now store or update the calculated weekly average into the WeeklyStats table
                        let params = {};

                        if (data.Count > 0) { // update the row that exists
                            logger.info("Updating WeeklyStats row that already exists...");

                            const params = {
                                TableName: table,
                                Key: {
                                    "user_id": user_id,
                                    "timestamp_weekStart": date
                                },
                                UpdateExpression: "set info.Moves.Steps.#avg = :steps_avg," +
                                "info.Moves.Distance.#avg = :distance_avg," +
                                "info.Moves.Calories.#avg = :calories_avg," +
                                "info.Moves.Active_time.#avg = :activeTime_avg",
                                ExpressionAttributeValues: {
                                    ":steps_avg": Averages.steps,
                                    ":distance_avg": Averages.distance,
                                    ":calories_avg": Averages.calories,
                                    ":activeTime_avg": Averages.activeTime

                                },
                                ExpressionAttributeNames: {
                                    "#avg": "avg"
                                },
                                ReturnValues: "UPDATED_NEW" // give the resulting updated fields as the JSON result
                            };

                            // update dynamo table
                            docClient.update(params, function (err, data) {
                                if (err) {
                                    const msg = "Error updating WeeklyStats Moves table. Error JSON: " + JSON.stringify(err, null, 2);
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
                            json.Moves.Steps.avg = Averages.steps;
                            json.Moves.Distance.avg = Averages.distance;
                            json.Moves.Calories.avg = Averages.calories;
                            json.Moves.Active_time.avg = Averages.activeTime;
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
            });

            // function to take a Moves week block and return its average
            // NOTE: Using Jawbone endpoint here as reading Moves data is expensive
            let returnWeeksAverage = function(user_id, date, callback) {
                logger.info("Calculating average Moves for week: " + date + "...");
                let path = "/nudge/api/v.1.1/users/@me/moves?start_time=" + date;

                let options = {
                    host: 'jawbone.com',
                    path: path,
                    headers: {'Authorization': 'Bearer ' + token},
                    method: 'GET'
                };
                let body = "";
                let json_res = {};
                let req = https.request(options, function (res) {
                    logger.debug('JAWBONE HTTP GET RESPONSE: ' + res.statusCode);

                    res.on('data', function (d) {
                        body += d;
                    });
                    res.on('end', function () {
                        json_res = JSON.parse(body);
                        if (res.statusCode != 200) {
                            // REST response BAD, output error
                            logger.error("Non 200 code for GET on Jawbone moves table. Error JSON:", JSON.stringify(json_res, null, 2));
                        } else {
                            if (json_res.data.size < 1) {
                                return callback(null)
                            }

                            // use these so we don't include the null items in the averaging
                            let Steps = {total: 0, totalCount: 0};
                            let Distance = {total: 0, totalCount: 0};
                            let Calories = {total: 0, totalCount: 0};
                            let ActiveTime = {total: 0, totalCount: 0};

                            for (let i = 0; i < 7; i++) {
                                let move = json_res.data.items[i];
                                if (move == null) { break ;} // end as there are less than 7 new days

                                // steps
                                if (move.details.steps != null) {
                                    Steps.total += move.details.steps;
                                    Steps.totalCount++;
                                }

                                // distance
                                if (move.details.distance != null) {
                                    Distance.total += move.details.distance;
                                    Distance.totalCount++;
                                }

                                // calories
                                if (move.details.calories != null) {
                                    Calories.total += move.details.calories;
                                    Calories.totalCount++;
                                }

                                // active time
                                if (move.details.active_time != null) {
                                    ActiveTime.total += move.details.active_time;
                                    ActiveTime.totalCount++;
                                }
                            }

                            // Calculate averages
                            let Averages = {steps: 0, sistance: 0, calories: 0, activeTime: 0};
                            Averages.steps = Math.ceil(Steps.total / Steps.totalCount);
                            Averages.distance = Math.ceil(Distance.total / Distance.totalCount);
                            Averages.calories = Math.ceil(Calories.total / Calories.totalCount);
                            Averages.activeTime = Math.ceil(ActiveTime.total / ActiveTime.totalCount);

                            return callback(Averages);
                        }


                    });
                    req.on('error', function (e) {
                        logger.error("Error reading Jawbone Moves table", e);
                    });

                });
                req.end();
            };
        }

        // function that is called after weeklyStats to give an output message
        function weeklyStatsCallback(success, message) {
            const output = "Moves weekly stats: " + message;
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
