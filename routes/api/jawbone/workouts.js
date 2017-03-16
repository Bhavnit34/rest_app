// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
var api = require('./api');
var loggerModule = require('../../logger');
// AWS Dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient()
var logger = loggerModule.getLogger();

router.get('/test', function(req,res){
    res.send('workouts working');
    logger.info("logger working");
});

// function to return stored workout data
router.get('/:userId/', function(req,res){
    var table = "Workouts";
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
router.post('/updateWorkouts', function(req,res_body){
    // make a jawbone REST request for workouts info
    var path = '/nudge/api/v.1.1/users/@me/workouts?';
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
            process.stdout.write(d);
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
                for (var i = 0; i < json_res.data.size; i++) {
                    api.clearEmptyDataStrings(json_res.data.items[i].details);
                }
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                putWorkouts();
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


    // Load workouts info into db
    var putWorkouts = function () {
        var table = "Workouts";
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
                    "timestamp_completed": json_res.data.items[i].time_completed,
                    "date": date.substr(0, 4) + "/" + date.substr(4, 2) + "/" + date.substr(6, 2),
                    "info": json_res.data.items[i]
                }
            };

            // update table
            logger.info("Adding workout " + (i+1) + " --> " + date + " for user " + user_id);
            docClient.put(params, function (err, data) {
                if (err) {
                    logger.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                    returnJson.DynamoDB[json_res.data.items[i].date.toString()] = JSON.stringify(err, null, 2);
                } else {
                    ++successCount;
                }
                updateDB(i + 1); //update table for next index
            })

        }
        // start at the first index, the function will iterate over all indexes synchronously until complete and return.
        updateDB(0);

    }
});

// function to calculate the stats from the whole table, if these values were lost
function calculateInitialStats(userID, callback) {
    let Count = {avg : 0, total : 0, totalCount : 0, avgCount : 0};
    let Intensity = {avg : 0, total : 0, totalCount : 0, avgCount : 0};
    let Calories = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};
    let Time = {avg : 0, min : 0, max :0, total : 0, totalCount : 0, avgCount : 0};


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
            Calories.min = data.Items[0].info.details.calories;
            Calories.max = data.Items[0].info.details.calories;
            Time.max = data.Items[0].info.details.active_time;
            Time.min = data.Items[0].info.details.active_time;
            for(let i = 0; i < data.Items.length; i++) {
                // loop through each row and cumulate the average

                // steps
                let count = data.Items[i].info.details.steps;
                if (count != null) {
                    Count.totalCount++;
                    Count.total += count;
                    if (count < Count.min) {
                        Count.min = count;
                    } else if (count > Count.max) {
                        Count.max = count;
                    }
                }

                // distance
                let distance = data.Items[i].info.details.intensity;
                if (distance != null) {
                    Intensity.totalCount++;
                    Intensity.total += distance;
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

                // time
                let time = data.Items[i].info.details.time;
                if (time != null) {
                    Time.totalCount++;
                    Time.total += time;
                    if (time < Time.min) {
                        Time.min = time;
                    } else if (time > Time.max) {
                        Time.max = time;
                    }
                }



            }
            Count.avg = Math.ceil(Count.total / Count.totalCount);
            Intensity.avg = Math.ceil(Intensity.total / Intensity.totalCount);
            Calories.avg = Math.ceil(Calories.total / Calories.totalCount);
            Time.avg = Math.ceil(Time.total / Time.totalCount);
            const timestamp_updated = Date.now().toString().substr(0,10);

            let stats = {
                Count : {
                    avg: Count.avg,
                    avg_count: Count.totalCount,
                    timestamp_updated: timestamp_updated
                },
                Intensity : {
                    avg: Intensity.avg,
                    avg_count: Intensity.totalCount,
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
                    avg: Time.avg,
                    min: Time.min,
                    max: Time.max,
                    avg_count: Time.totalCount,
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
    let newStats = {Count:{min:0, max:0, avg:0, avg_count: 0, timestamp_updated: 0},
        Intensity:{min:0, max:0, avg:0,avg_count: 0, timestamp_updated: 0},
        Calories:{min:0, max:0, avg:0,avg_count: 0, timestamp_updated: 0},
        Time:{min:0, max:0, avg:0,avg_count: 0, timestamp_updated: 0}};

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
                    logger.error("Unable to read STATS Workouts item. Error JSON:", JSON.stringify(err, null, 2));
                } else {
                    let wo = data.Items[0].info.Workouts;
                    // to speed up checking for null, check for the string ":null" in the json
                    let temp = JSON.stringify(data.Items[0].info.Workouts, null, 2);
                    let jsonString = temp.replace(/ /g,''); // trim all whitespace
                    if (jsonString.indexOf(":null") > -1) {
                        // we need to restore the stats
                        logger.info("Workouts Stats not in table. Updating...");
                        calculateInitialStats(user_id, function(res){
                            return callback(res);
                        });
                    } else {
                        logger.info("Checking for new Moves values to update the stats...");
                        // update the stats if there are new items in the DB since last update
                        const params = {
                            TableName: "Workouts",
                            KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
                            ExpressionAttributeValues: {
                                ":user_id": user_id,
                                ":timestamp": wo.Count.timestamp_updated
                            }
                        };

                        docClient.query(params, function (err, data) {
                            if (err) {
                                logger.error("Unable to read Workouts item. Error JSON:", JSON.stringify(err, null, 2));
                            } else {
                                if(data.Count == 0) {return callback(null);} // don't write any stats if there are no updates
                                // calculate new stats by taking into account the new values
                                const row = data.Items;
                                // use these so we don't include null moves in the averaging
                                let Count = { total: 0, totalCount : 0};
                                let Intensity = { total: 0, totalCount : 0};
                                let Calories = { total: 0, totalCount : 0};
                                let Time = { total: 0, totalCount : 0};
                                // assign local min/max to what we currently have in the stats table
                                newStats.Calories.max = wo.Calories.max;
                                newStats.Calories.min = wo.Calories.min;
                                newStats.Time.max = wo.Active_time.max;
                                newStats.Time.min = wo.Active_time.min;

                                for (let i = 0; i < data.Items.length; i++) {
                                    // steps
                                    let count = row[i].info.details.steps;
                                    if (count != null) {
                                        Count.totalCount++;
                                        Count.total += count;
                                    }

                                    // intensity
                                    let intensity = row[i].info.details.intensity;
                                    if (intensity != null) {
                                        Intensity.totalCount++;
                                        Intensity.total += intensity;
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

                                    // time
                                    let time = row[i].info.details.time;
                                    if (time != null) {
                                        Time.totalCount++;
                                        if (time > newStats.Active_time.max) {
                                            newStats.Time.max = time;
                                        } else if (time < newStats.Active_time.min) {
                                            newStats.Time.min = time;
                                        }
                                        Time.total += time;
                                    }

                                }
                                // calculate new average by adding on the new values and dividng by (total + no. of new values)
                                // steps
                                newStats.Count.avg = Math.ceil(((wo.Count.avg * wo.Count.avg_count) + Count.total) / (wo.Count.avg_count + Count.totalCount));
                                newStats.Count.avg_count = wo.Count.avg_count + Count.totalCount;
                                newStats.Count.timestamp_updated = Date.now().toString().substr(0, 10);
                                // distance
                                newStats.Intensity.avg = Math.ceil(((wo.Intensity.avg * wo.Intensity.avg_count) + Intensity.total) / (wo.Intensity.avg_count + Intensity.totalCount));
                                newStats.Intensity.avg_count = wo.Intensity.avg_count + Intensity.totalCount;
                                newStats.Intensity.timestamp_updated = Date.now().toString().substr(0, 10);
                                // calories
                                newStats.Calories.avg = Math.ceil(((wo.Calories.avg * wo.Calories.avg_count) + Calories.total) / (wo.Calories.avg_count + Calories.totalCount));
                                newStats.Calories.avg_count = wo.Calories.avg_count + Calories.totalCount;
                                newStats.Calories.timestamp_updated = Date.now().toString().substr(0, 10);
                                // active time
                                newStats.Time.avg = Math.ceil(((wo.Active_time.avg * wo.Active_time.avg_count) + Time.total) / (wo.Active_time.avg_count + Time.totalCount));
                                newStats.Time.avg_count = wo.Active_time.avg_count + Time.totalCount;
                                newStats.Time.timestamp_updated = Date.now().toString().substr(0, 10);
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
                logger.info("Workouts Stats already up to date");
                updateWeeklyStats(weeklyStatsCallback);
                return;
            }



            // otherwise update the Stats table
            const params = {
                TableName:"Stats",
                Key:{"user_id": user_id},
                UpdateExpression: "set info.Moves.Count.#avg = :Count_avg," +
                " info.Moves.Count.avg_count = :Count_avg_count," +
                " info.Moves.Count.timestamp_updated = :Count_timestamp_updated," +

                " info.Moves.Intensity.#avg = :Intensity_avg," +
                " info.Moves.Intensity.avg_count = :Intensity_avg_count," +
                " info.Moves.Intensity.timestamp_updated = :Intensity_timestamp_updated," +

                " info.Moves.Calories.#avg = :Calories_avg," +
                " info.Moves.Calories.#min = :Calories_min," +
                " info.Moves.Calories.#max = :Calories_max," +
                " info.Moves.Calories.avg_count = :Calories_avg_count," +
                " info.Moves.Calories.timestamp_updated = :Calories_timestamp_updated," +

                " info.Moves.Time.#avg = :Time_avg," +
                " info.Moves.Time.#min = :Time_min," +
                " info.Moves.Time.#max = :Time_max," +
                " info.Moves.Time.avg_count = :Time_avg_count," +
                " info.Moves.Time.timestamp_updated = :Time_timestamp_updated",
                ExpressionAttributeValues:{
                    // count
                    ":steps_avg_count": stats.Count.avg_count,
                    ":steps_avg": stats.Count.avg,
                    ":steps_timestamp_updated" : parseInt(stats.Count.timestamp_updated),

                    // intensity
                    ":distance_avg_count": stats.Intensity.avg_count,
                    ":distance_avg": stats.Intensity.avg,
                    ":distance_timestamp_updated" : parseInt(stats.Intensity.timestamp_updated),

                    // calories
                    ":calories_min": stats.Calories.min,
                    ":calories_max": stats.Calories.max,
                    ":calories_avg_count": stats.Calories.avg_count,
                    ":calories_avg": stats.Calories.avg,
                    ":calories_timestamp_updated" : parseInt(stats.Calories.timestamp_updated),

                    // time
                    ":activeTime_min": stats.Time.min,
                    ":activeTime_max": stats.Time.max,
                    ":activeTime_avg_count": stats.Time.avg_count,
                    ":activeTime_avg": stats.Time.avg,
                    ":activeTime_timestamp_updated" : parseInt(stats.Time.timestamp_updated)
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
                    logger.error("Error updating Stats Workouts table. Error JSON:", JSON.stringify(err, null, 2));
                    returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                    returnJson.DynamoDB.error = true;
                    return res.status(500).send(returnJson);
                } else {
                    logger.info("Workouts Stats updated!");
                    // move onto updating the weekly stats
                    updateWeeklyStats(weeklyStatsCallback);
                }
            });

        });

        function updateWeeklyStats(callback) {
            logger.info("Calculating weeklyStats for Workouts...");
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
                    // to speed up checking for null, check for the string ":null" in the json
                    let temp = JSON.stringify(data.Items[0].info.Moves);
                    let jsonString = temp.replace(/ /g,''); // trim all whitespace

                    if (data.Count > 0 && jsonString.indexOf(":null") == -1) {
                        // There already is an entry for this week
                        const msg  = "There already exists an entry for Workouts in week : " + dateString;
                        logger.info(msg);
                        return callback(true, msg);
                    } else {
                        returnWeeksAverage(user_id, date, function(Averages) {
                            if(Averages == null){return callback(false, "error in getting average for week starting: " + dateString)}
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
                                    UpdateExpression: "set info.Workouts.Count.#avg = :Count_avg," +
                                    " info.Workouts.Intensity.#avg = :Intensity_avg," +
                                    " info.Workouts.Calories.#avg = :Calories_avg," +
                                    " info.Workouts.Time.#avg = :Time_avg",
                                    ExpressionAttributeValues:{
                                        ":Count_avg": Averages.Count,
                                        ":Intensity_avg": Averages.Intensity,
                                        ":Calories_avg": Averages.Calories,
                                        ":Time_avg": Averages.Time

                                    },
                                    ExpressionAttributeNames: {
                                        "#avg": "avg"
                                    },
                                    ReturnValues:"UPDATED_NEW" // give the resulting updated fields as the JSON result
                                };

                                // update dynamo table
                                docClient.update(params, function(err, data) {
                                    if (err) {
                                        const msg = "Error updating WeeklyStats Workouts table. Error JSON: " + JSON.stringify(err, null, 2);
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
                                json.Workouts.Count.avg = Averages.Count;
                                json.Workouts.Intensity.avg = Averages.Intensity;
                                json.Workouts.Calories.avg = Averages.Calories;
                                json.Workouts.Time.avg = Averages.Time;
                                params = {
                                    TableName: table,
                                    Item: {
                                        "user_id": user_id,
                                        "timestamp_weekStart": date,
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

                }
            });

            // function to take a Workouts week block and return its average
            let returnWeeksAverage = function(user_id, date, callback) {
                logger.info("Calculating average Workouts for week: " + date + "...");
                const params = {
                    TableName: "Workouts",
                    KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
                    ExpressionAttributeValues: {
                        ":user_id": user_id,
                        ":timestamp": date
                    },
                    Limit: 7
                };

                docClient.query(params, function(err, data) {
                    if (err) {
                        logger.error("Error reading Workouts table. Error JSON:", JSON.stringify(err, null, 2));
                    } else {
                        if (data.Count < 1) {
                            return callback(null)
                        } else {
                            // use these so we don't include the null items in the averaging
                            let Count = {total: 0, totalCount: 0};
                            let Intensity = {total: 0, totalCount: 0};
                            let Calories = {total: 0, totalCount: 0};
                            let Time = {total: 0, totalCount: 0};

                            for (let i = 0; i < data.Items.length; i++) {
                                let workout = data.Items[i].info;
                                if (workout == null) { continue ;}

                                // count
                                let count = workout.details.awake_time;
                                if (count != null) {
                                    Count.total += count;
                                    Count.totalCount++;
                                }

                                // asleep time
                                let intensity = workout.details.intensity;
                                if (intensity != null) {
                                    Intensity.total += intensity;
                                    Intensity.totalCount++;
                                }

                                // calories
                                if (workout.details.calories != null) {
                                    Calories.total += workout.details.calories;
                                    Calories.totalCount++;
                                }

                                // time
                                if (workout.details.time != null) {
                                    Time.total += workout.details.time;
                                    Time.totalCount++;
                                }

                            }

                            // Calculate averages
                            let Averages = {Count: 0, Intensity: 0, Calories: 0, Time: 0};
                            Averages.Count = Math.ceil(Count.total / Count.totalCount);
                            Averages.Intensity = Math.ceil(Intensity.total / Intensity.totalCount);
                            Averages.Calories = Math.ceil(Calories.total / Calories.totalCount);
                            Averages.Time = Math.ceil(Time.total / Time.totalCount);

                            return callback(Averages);
                        }
                    }
                });
            }
        }

        // function that is called after weeklyStats to give an output message
        function weeklyStatsCallback(success, message) {
            const output = "Workouts weekly stats: " + message;
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