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


router.get('/test', function(req,res){res.send('stats moves working');});
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
                if (steps !== null) {
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
                if (distance !== null) {
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
                if (calories !== null) {
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
                if (activeTime !== null) {
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
                                if(data.Count === 0) {return callback(null);} // don't write any stats if there are no updates
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
                                    if (steps !== null) {
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
                                    if (distance !== null) {
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
                                    if (calories !== null) {
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
                                    if (activeTime !== null) {
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
                    returnWeeksAverage(user_id, date, function (Averages) {
                        if(Averages === null){return callback(true, "updateWeeklyStats() : avg could not be calculated from " + dateString)}
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
                                " info.Moves.Distance.#avg = :distance_avg," +
                                " info.Moves.Calories.#avg = :calories_avg," +
                                " info.Moves.Active_time.#avg = :activeTime_avg," +
                                " date_weekStart = :date_weekStart",
                                ExpressionAttributeValues: {
                                    ":steps_avg": Averages.steps,
                                    ":distance_avg": Averages.distance,
                                    ":calories_avg": Averages.calories,
                                    ":activeTime_avg": Averages.activeTime,
                                    ":date_weekStart": formattedDate,

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
                                    "date_weekStart": formattedDate,
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
                        if (res.statusCode !== 200) {
                            // REST response BAD, output error
                            logger.error("Non 200 code for GET on Jawbone moves table. Error JSON:", JSON.stringify(json_res, null, 2));
                        } else {
                            if (json_res.data.size < 1) {
                                return callback(null);
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
                                if (move.details.steps !== null) {
                                    Steps.total += move.details.steps;
                                    Steps.totalCount++;
                                }

                                // distance
                                if (move.details.distance !== null) {
                                    Distance.total += move.details.distance;
                                    Distance.totalCount++;
                                }

                                // calories
                                if (move.details.calories !== null) {
                                    Calories.total += move.details.calories;
                                    Calories.totalCount++;
                                }

                                // active time
                                if (move.details.active_time !== null) {
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