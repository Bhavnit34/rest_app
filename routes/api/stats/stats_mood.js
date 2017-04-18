// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let api = require('./../api');
let loggerModule = require('../../logger');
let telegram = require ('../telegram/telegram');
let request = require('request');
// AWS Dependencies
let AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
let docClient = new AWS.DynamoDB.DocumentClient();
let logger = loggerModule.getLogger();


router.get('/test', function(req,res){res.status(200).send('stats mood working');});


// function to calculate the stats from the whole table, if these values were lost
function calculateInitialStats(userID, callback) {
    let avg = 0;
    let total = 0;
    let totalCount = 0;
    const table = "DailyMood";
    const params = {
        TableName: table,
        KeyConditionExpression: "user_id = :user_id",
        ExpressionAttributeValues: {":user_id" : userID}

    };

    docClient.query(params, function(err, data) {
        if (err) {
            logger.error("Unable to read DailyMood item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            // proceed to calculating the stats
            for(let i = 0; i < data.Items.length; i++) {

                // loop through each row and cumliate the average
                let mood = data.Items[i].mood;
                if (mood != null) {
                    totalCount++;
                    total += mood;
                }
            }
            avg = Math.ceil(total / totalCount);
            let avg_count = data.Items.length;
            let timestamp_updated = Date.now().toString().substr(0,10);

            let stats = {
                avg: avg,
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
            let table = "Stats";
            const params = {
                TableName: table,
                KeyConditionExpression: "user_id = :user_id",
                ExpressionAttributeValues: {":user_id" : user_id}

            };
            docClient.query(params, function (err, data) {
                if (err) {
                    logger.error("Unable to read STATS Mood item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    let mood = data.Items[0].info.Mood;
                    if (mood.avg === null || mood.avg_count === null) {
                        // we need to restore the stats
                        logger.info("Mood Stats not in table. Updating...");
                        stats = calculateInitialStats(user_id, function(res){
                            return callback(res);
                        });
                    } else {
                        logger.info("Checking for new Mood values to update the stats...");
                        // update the stats if there are new items in the DB since last update
                        const params = {
                            TableName: "DailyMood",
                            KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
                            ExpressionAttributeValues: {
                                ":user_id": user_id,
                                ":timestamp": mood.timestamp_updated
                            }
                        };

                        docClient.query(params, function (err, data) {
                            if (err) {
                                logger.error("Unable to read Mood item. Error JSON:", JSON.stringify(err, null, 2));
                            } else {
                                if(data.Count === 0) {return callback(null);} // don't write any stats if there are no updates
                                // calculate new stats
                                const row = data.Items;
                                let total = 0;
                                let totalCount = 0; // use this so we don't include null moods in the averaging
                                for (let i = 0; i < data.Items.length; i++) {
                                    let mood = row[i].mood;
                                    if (mood === null) { continue; }
                                    totalCount++;
                                    total += mood;

                                }
                                // calculate new average by adding on the new values and dividng by (total + no. of new values)
                                stats.avg = Math.ceil(((mood.avg * mood.avg_count) + total) / (mood.avg_count + totalCount));
                                stats.avg_count = mood.avg_count + totalCount;
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
            if (stats === null) {
                logger.info("Mood Stats already up to date");
                updateWeeklyStats(weeklyStatsCallback);
                return;
            }

            // otherwise update the Stats table
            const params = {
                TableName:"Stats",
                Key:{"user_id": user_id},
                UpdateExpression: "set info.Mood.#avg = :avg," +
                " info.Mood.avg_count = :avg_count," +
                " info.Mood.timestamp_updated = :timestamp_updated",
                ExpressionAttributeValues:{
                    ":avg_count": stats.avg_count,
                    ":avg": stats.avg,
                    ":timestamp_updated" : parseInt(stats.timestamp_updated)
                },
                ExpressionAttributeNames: {
                    "#avg": "avg",
                },
                ReturnValues:"UPDATED_NEW" // give the resulting updated fields as the JSON result

            };

            // update dynamo table
            docClient.update(params, function(err, data) {
                if (err) {
                    logger.error("Error updating Stats Mood table. Error JSON:", JSON.stringify(err, null, 2));
                    returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                    returnJson.DynamoDB.error = true;
                    return res.status(500).send(returnJson);
                } else {
                    logger.info("Mood Stats updated!");
                    // move onto updating the weekly stats
                    updateWeeklyStats(weeklyStatsCallback);
                }
            });

        });

        function updateWeeklyStats(callback) {
            logger.info("Calculating weeklyStats for Mood...");
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
                                UpdateExpression: "set info.Mood.#avg = :avg, date_weekStart = :date_weekStart",
                                ExpressionAttributeValues:{
                                    ":avg": avg,
                                    ":date_weekStart" : formattedDate
                                },
                                ExpressionAttributeNames: {
                                    "#avg": "avg"
                                },
                                ReturnValues:"UPDATED_NEW" // give the resulting updated fields as the JSON result
                            };

                            // update dynamo table
                            docClient.update(params, function(err, data) {
                                if (err) {
                                    const msg = "Error updating WeeklyStats Mood table. Error JSON: " + JSON.stringify(err, null, 2);
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
                            json.Mood.avg = avg;
                            params = {
                                TableName: table,
                                Item: {
                                    "user_id": user_id,
                                    "timestamp_weekStart": date,
                                    "info": json,
                                    "date_weekStart": formattedDate
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

            // function to take a mood week block and return its average
            let returnWeeksAverage = function(user_id, date, callback) {
                logger.info("Calculating average Mood for week: " + date + "...");
                const params = {
                    TableName: "DailyMood",
                    KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
                    ExpressionAttributeValues: {
                        ":user_id" : user_id,
                        ":timestamp" : date
                    },
                    Limit: 7
                };

                docClient.query(params, function(err, data) {
                    if (err) {
                        logger.error("Error reading Mood table. Error JSON:", JSON.stringify(err, null, 2));
                    } else {
                        if (data.Count < 1) {
                            logger.info("returnWeeksAverage() : No mood items exist from this date");
                            return callback(null);
                        } else {
                            let total = 0;
                            let totalCount = 0; // use this so we don't include the null items in the averaging
                            for(let i = 0; i < data.Items.length; i++) {
                                let row = data.Items[i];
                                if (row.mood === null) {continue;} // skip days where mood wasn't recorded
                                total += row.mood;
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
            const output = "Mood weekly stats: " + message;
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