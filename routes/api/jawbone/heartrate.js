// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
var api = require('./../api');
var loggerModule = require('../../logger');
// AWS Dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();
var logger = loggerModule.getLogger();

router.get('/test', function(req,res){
    res.send('heartrate working');
    logger.info("logger working");
});

// function to return stored heart rate data
router.get('/:userId/', function(req, res) {
    var table = "HeartRate";
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
            query += " AND #timestamp BETWEEN :startStamp AND :endStamp"; //results between dates
        } else if (startDate) {
            query += " AND #timestamp >= :startStamp"; // show dates going forwards from startDate
        } else if (endDate) {
            query += " AND #timestamp <= :endStamp"; // show dates going backwards from endDate
        }

        // Retrieve data from db
        var params = {
            TableName: table,
            KeyConditionExpression: query,
            ExpressionAttributeValues: attrValues,
            Limit: limit
        };

        if (startDate || endDate) {
            params.ExpressionAttributeNames = {
                "#timestamp": "timestamp"
            }
        }



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
router.post('/updateHeartRates', function(req,res_body){
    // make a jawbone REST request for heart rate info
    var path = '/nudge/api/v.1.1/users/@me/heartrates?';
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
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                putHeartRates();
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


    // Load HR info into db
    var putHeartRates = function () {
        var table = "HeartRate";
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
                    return res_body.status(200).send(returnJson);
                } else {
                    logger.error(successCount + "/" + json_res.data.size + " items updated.");
                    returnJson.DynamoDB.message = successCount + "/" + json_res.data.size + " items updated. See logs.";
                    returnJson.DynamoDB.error = true;
                    return res_body.status(500).send(returnJson);
                }
            }

            // set unique table parameters
            var date = json_res.data.items[i].date.toString();
            var params = {
                TableName: table,
                Item: {
                    "user_id": user_id,
                    "timestamp": json_res.data.items[i].time_created,
                    "date": date.substr(0, 4) + "/" + date.substr(4, 2) + "/" + date.substr(6, 2),
                    "heartrate": json_res.data.items[i].resting_heartrate
                }
            };

            // update table
            logger.info("Adding heart rate " + (i + 1) + " --> " + date + " for user " + user_id);
            docClient.put(params, function (err, data) {
                if (err) {
                    logger.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    ++successCount;
                }
                updateDB(i + 1);
            });

        }
        // start at the first index, the function will iterate over all indexes synchronously until complete and return.
        updateDB(0);
    };


});


// function to calculate the stats from the whole table, if these values were lost
function calculateInitialStats(userID, callback) {
    let avg = 0;
    let total = 0;
    let totalCount = 0;
    let min = 0;
    let max = 0;
    const table = "HeartRate";
    const params = {
        TableName: table,
        KeyConditionExpression: "user_id = :user_id",
        ExpressionAttributeValues: {":user_id" : userID}

    };

    docClient.query(params, function(err, data) {
        if (err) {
            logger.error("Unable to read HR item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            // proceed to calculating the stats
            min = data.Items[0].heartrate;
            max = data.Items[0].heartrate;
            for(let i = 0; i < data.Items.length; i++) {


                // loop through each row and cumliate the average
                let hr = data.Items[i].heartrate;
                if (hr != null) {
                    totalCount++;
                    total += hr;
                    if (hr < min) {
                        min = hr;
                    } else if (hr > max) {
                        max = hr;
                    }
                }
            }
            avg = Math.ceil(total / totalCount);
            const avg_count = data.Items.length;
            const timestamp_updated = Date.now().toString().substr(0,10);

            let stats = {
                avg: avg,
                min: min,
                max: max,
                avg_count: avg_count,
                timestamp_updated: timestamp_updated
            };
            return callback(stats);
        }

    });
}

// function to update the stats table
router.post('/updateStats', function(req, res) {
    let user_id = "";
    let returnJson = api.newReturnJson();
    let token = "";
    let stats = {};

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
                    logger.error("Unable to read STATS HR item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    let hr = data.Items[0].info.HeartRate;
                    if (hr.avg == null || hr.min == null || hr.max == null || hr.avg_count == null) {
                        // we need to restore the stats
                        logger.info("HR Stats not in table. Updating...");
                        stats = calculateInitialStats(user_id, function(res){
                            return callback(res);
                        });
                    } else {
                        logger.info("Checking for new HR values to update the stats...");
                        // update the stats if there are new items in the DB since last update
                        const params = {
                            TableName: "HeartRate",
                            KeyConditionExpression: "user_id = :user_id AND #timestamp > :timestamp",
                            ExpressionAttributeValues: {
                                ":user_id": user_id,
                                ":timestamp": hr.timestamp_updated
                            },
                            ExpressionAttributeNames: {
                                "#timestamp": "timestamp"
                            }
                        };

                        docClient.query(params, function (err, data) {
                            if (err) {
                                logger.error("Unable to read HR item. Error JSON:", JSON.stringify(err, null, 2));
                            } else {
                                if(data.Count == 0) {return callback(null);} // don't write any stats if there are no updates
                                // calculate new stats
                                const row = data.Items;
                                let total = 0;
                                let totalCount = 0; // use this so we don't include null heartrates in the averaging
                                stats.max = hr.max;
                                stats.min = hr.min;
                                for (let i = 0; i < data.Items.length; i++) {
                                    let heartrate = row[i].heartrate;
                                    if (heartrate == null) { continue; }
                                    totalCount++;
                                    if (heartrate > stats.max) {
                                        stats.max = heartrate;
                                    } else if (heartrate < stats.min) {
                                        stats.min = heartrate;
                                    }
                                    total += heartrate;

                                }
                                // calculate new average by adding on the new values and dividng by (total + no. of new values)
                                stats.avg = Math.ceil(((hr.avg * hr.avg_count) + total) / (hr.avg_count + totalCount));
                                stats.avg_count = hr.avg_count + totalCount;
                                stats.timestamp_updated = Date.now().toString().substr(0, 10);
                                return callback(stats);
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
                logger.info("HR Stats already up to date");
                updateWeeklyStats(weeklyStatsCallback);
                return;
            }

            // otherwise update the Stats table
            const params = {
                TableName:"Stats",
                Key:{"user_id": user_id},
                UpdateExpression: "set info.HeartRate.#avg = :avg," +
                " info.HeartRate.#min = :min," +
                " info.HeartRate.#max = :max," +
                " info.HeartRate.avg_count = :avg_count," +
                " info.HeartRate.timestamp_updated = :timestamp_updated",
                ExpressionAttributeValues:{
                    ":min": stats.min,
                    ":max": stats.max,
                    ":avg_count": stats.avg_count,
                    ":avg": stats.avg,
                    ":timestamp_updated" : parseInt(stats.timestamp_updated)
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
                    logger.error("Error updating Stats HR table. Error JSON:", JSON.stringify(err, null, 2));
                    returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                    returnJson.DynamoDB.error = true;
                    return res.status(500).send(returnJson);
                } else {
                    logger.info("HR Stats updated!");
                    // move onto updating the weekly stats
                    updateWeeklyStats(weeklyStatsCallback);
                }
            });

        });

        function updateWeeklyStats(callback) {
            logger.info("Calculating weeklyStats for HR...");
            // firstly calculate the latest Sunday
            const table = "WeeklyStats";
            let sunday = new Date();
            sunday.setHours(0,0,0,0);
            while (sunday.getDay() !== 0) { // 0 = Sunday
                sunday = new Date(sunday.getTime() - 86400000); // i.e. minus one day
                if (sunday.getHours() === 23) {
                    sunday = new Date(sunday.getTime() + 3600000); // add 1 hour if it goes into DST
                }
            }
            // the 10 digit timestamp of the sunday
            let date = parseInt(sunday.getTime().toString().substr(0,10));
            // the date to be read in the logs
            let dateString = sunday.toString().split(" ").slice(0,4).join(" ") + " (" + date + ")";

            // e.g. 2017/01/01, the date to store in the table
            let formattedDate = sunday.getFullYear() + "/" + api.pad(sunday.getMonth()+1, 2).toString() + "/"
                + api.pad(sunday.getDate(),2);

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
                    returnWeeksAverage(user_id, date, function(avg) {
                        if(avg === null){return callback(true, "updateWeeklyStats() : avg could not be calculated from " + dateString)}
                        // now store or update the calculated weekly average into the WeeklyStats table
                        let params = {};

                        if (data.Count > 0) { // update the row that exists
                            logger.info("Updating WeeklyStats row that already exists...");

                            const params = {
                                TableName: table,
                                Key:{
                                    "user_id": user_id,
                                    "timestamp_weekStart" : date
                                },
                                UpdateExpression: "set info.HeartRate.#avg = :avg, date_weekStart = :date_weekStart",
                                ExpressionAttributeValues:{
                                    ":avg": avg,
                                    ":date_weekStart": formattedDate
                                },
                                ExpressionAttributeNames: {
                                    "#avg": "avg"
                                },
                                ReturnValues:"UPDATED_NEW" // give the resulting updated fields as the JSON result
                            };

                            // update dynamo table
                            docClient.update(params, function(err, data) {
                                if (err) {
                                    const msg = "Error updating WeeklyStats HR table. Error JSON: " + JSON.stringify(err, null, 2);
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
                            json.HeartRate.avg = avg;
                            params = {
                                TableName: table,
                                Item: {
                                    "user_id": user_id,
                                    "timestamp_weekStart": date,
                                    "date_weekStart": formattedDate,
                                    "info": json
                                }
                            };

                            docClient.put(params,function(err, data) {
                                let msg ="";
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
            // function to take a HR week block and return its average
            let returnWeeksAverage = function(user_id, date, callback) {
                logger.info("Calculating average HR for week: " + date + "...");
                const params = {
                    TableName: "HeartRate",
                    KeyConditionExpression: "user_id = :user_id AND #timestamp > :timestamp",
                    ExpressionAttributeValues: {
                        ":user_id" : user_id,
                        ":timestamp" : date
                    },
                    ExpressionAttributeNames : {"#timestamp" : "timestamp"},
                    Limit: 7
                };

                docClient.query(params, function(err, data) {
                    if (err) {
                        logger.error("Error reading HeartRate table. Error JSON:", JSON.stringify(err, null, 2));
                    } else {
                        if (data.Count < 1) {
                            return callback(null);
                        } else {
                            let total = 0;
                            let totalCount = 0; // use this so we don't include the null items in the averaging
                            for(let i = 0; i < data.Items.length; i++) {
                                let hr = data.Items[i];
                                if (hr.heartrate === null) {continue;} // skip days where HR wasn't recorded
                                total += hr.heartrate;
                                totalCount++;
                            }
                            let avg = Math.ceil(total / totalCount);
                            return callback(avg);
                        }
                    }
                });
            }

        }

        // function that is called after weeklyStats to give an output message
        function weeklyStatsCallback(success, message) {
            const output = "HR weekly stats: " + message;
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