// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let request = require('request');
let loggerModule = require('../../logger');
let api = require('../api');
let telegram = require('./telegram');
// AWS Dependencies
let AWS = require('aws-sdk');
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
const docClient = new AWS.DynamoDB.DocumentClient();
const logger = loggerModule.getLogger();

// function to check if the mood for the current day has been logged
function checkMoodExists(userID, timestamp, callback) {
    const params = {
        TableName : "DailyMood",
        KeyConditionExpression: "user_id = :user_id AND timestamp_completed >= :timestamp",
        ExpressionAttributeValues: {
            ":user_id" : userID,
            ":timestamp" : timestamp
        },
        Limit: 1
    };

    docClient.query(params, function(err, data) {
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

// function to obtain the user's latest awoken time
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

// function to determine if the user is well into their day, and if so, ask about their day using Telegram
router.post('/askAboutDay', function(req,res_body){
    let returnJson = api.newReturnJson();
    let userID = "";
    let token = "";
    let msg = "";

    // This is where we respond to the request
    let callback = function(error, code, type, msg) {
        returnJson[type].error = error;
        returnJson[type].message = msg;
        return res_body.status(code).send(returnJson);
    };

    // check userId
    if (!req.body.userId) {
        msg = "Missing userId!";
        return callback(true, 400, "Jawbone", msg);
    } else {
        userID = req.body.userId;
    }

    // authenticate token
    if (!req.body.token) {
        msg = "Token missing!";
        return callback(true, 401, "Jawbone", msg);
    } else {
        token = req.body.token;
    }

    api.authenticateToken(token, userID, false, function(authenticated) {
        if (authenticated === false) {
            return callback(true, 401, "DynamoDB", "Authentication Failed!");
        }


        let move = {};
        // retrieve the latest move
        let today = new Date();
        today.setHours(0,0,0,0);
        let timestamp = parseInt(today.getTime().toString().substr(0,10));
        const params = {
            TableName : "Moves",
            KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
            ExpressionAttributeValues: { ":user_id" : userID, ":timestamp" : timestamp }
        };

        // Query the Moves table for todays activity
        docClient.query(params, function(err, data) {
            if (err) {
                msg = ("askAboutDay() : Error reading Moves table. Error JSON: " + JSON.stringify(err, null, 2));
                return callback(true, 500, "DynamoDB", msg);
            }
            if (data.Count === 0) {
                msg = ("askAboutDay() : Could not find a move for today.");
                return callback(false, 200, "DynamoDB", msg);
            } else {
                move = data.Items[0].info;
                checkLatestMood();
            }
        });

        let checkLatestMood = function() {
            logger.info("Checking if the time is right to ask about the users day...");
     
            let msg = "";

            // firstly find how long they are awake for on average
            const params = {
                TableName: "Stats",
                Key: {"user_id": userID},
            };

            // query Stats table for the users awake duration
            docClient.get(params, function(err, data) {
                if (err) {
                    msg = "askAboutDay() : Unable to read Stats item. Error JSON:" + JSON.stringify(err, null, 2);
                    logger.error(msg);
                    return callback(true, 500, "DynamoDB", msg);
                }
                let awake_duration = data.Item.info.Sleep.AwakeDuration.avg;

                // now check that the time is about right to ask about their day
                let awake_hours = Math.round(awake_duration / 3600); // convert seconds to hours
                let target_hour = Math.round(awake_hours * 0.75); // set a target time of 3/4 into the day

                // calculate the latest awake time as the nearest one to (now - awake_hours)
                // this is so we can query the awake time of the previous day if we are checking after midnight
                let midnight = new Date(new Date().getTime() - (awake_duration * 1000));
                midnight.setHours(0,0,0,0);
                let timestamp_midnight = parseInt(midnight.getTime().toString().substr(0,10));


                // now check that the mood hasn't been filled in for the day of the awake_time
                let date = move.date.toString();
                // midnight of the day
                let dateStart = new Date(move.time_completed * 1000);
                dateStart.setHours(0,0,0,0);
                let formattedDate = date.substr(0, 4) + "/" + date.substr(4, 2) + "/" + date.substr(6, 2);
                // first ensure the mood doesn't already exist
                checkMoodExists(userID, timestamp_midnight, function (error, exists) {
                    if (error) {
                        msg = "askAboutDay() : could not get mood information from the DailyMood table";
                        logger.error(msg);
                        return callback(true, 500, "DynamoDB", msg);
                    }
                    if (exists) {
                        const msg = "The user has already given us their day summary";
                        logger.info(msg);
                        return callback(false, 200, "DynamoDB", msg);
                    } else {
                        ask(timestamp_midnight, awake_hours, target_hour);
                    }
                })
            }); // end query of Stats table
        }; // end function checkLatestMood()


        let ask = function(timestamp_midnight, awake_hours, target_hour) {
            let now = new Date();
            logger.info("User is awake for " + awake_hours + " hours. The target hour is therefore " + target_hour + " hours past awake time");
            getAwokenTime(userID, timestamp_midnight, function(awoken_time) {
                if (!awoken_time) {
                    msg = "askAboutDay() : time awoken is currently not available";
                    logger.info(msg);
                    return callback(false, 200, "DynamoDB", msg);
                }

                let awakeDate = new Date(awoken_time * 1000);
                // add on 3/4 of a users day. This is our target start time to ask
                let targetDate = new Date(awakeDate.getTime() + (3600000 * target_hour));
                // get last hour to ask. This is when we guess the user will go to sleep, so don't ask after that.
                let lastDate = new Date(awakeDate.getTime() + (3600000 * awake_hours));

                logger.info ("The target Date is " + targetDate + ". The latest time to ask is at " + lastDate);
                if ((now.getTime() >= targetDate.getTime()) && (now.getTime() <= lastDate.getTime())) {
                    // it is a suitable time to ask about the users day
                    // now we must check if they are not too busy, using recorded active time and steps
                    const params = {
                        TableName : "Moves",
                        KeyConditionExpression : "user_id = :user_id AND timestamp_completed > :timestamp",
                        ExpressionAttributeValues : {":user_id" : userID, ":timestamp" : parseInt(timestamp_midnight)},
                        Limit: 1
                    };

                    // read Moves table and find recent active time and steps
                    docClient.query(params, function(err, data) {
                        if (err) {
                            msg = "askAboutDay() : error reading Moves table. Error JSON: " + JSON.stringify(err,null,2);
                            logger.error(msg);
                            return callback(true, 500, "DynamoDB", msg);
                        }
                        if (data.Count < 1) {
                            msg = "askAboutDay() : There is no move data to query for today";
                            logger.info(msg);
                            return callback(false, 200, "DynamoDB", msg);
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
                                break;
                            } else {
                                hour--;
                                hour = api.pad(hour, 2).toString();
                                hourly_total = dateString + hour;
                            }
                        }


                        if (active_time === -1 ) {
                            // we didn't find a recent stat about the users activity
                            msg = "Not enough information to make a decision about the users day. active_time = " + active_time + ", steps = " + steps;
                            logger.info(msg);
                            return callback(false, 200, "DynamoDB", msg);
                        }

                        // finally check that they are not too busy, and if so send a Telegram request
                        if (active_time <= 400 && steps <= 300) {
                            logger.info("User is not busy. Asking about their day... active_time = " + active_time + ", steps = " + steps);
                            // the user is active but not too busy
                            telegramRequest(userID, timestamp_midnight, function (error, msg) {
                                let code = error ? 500 : 200;
                                return callback(error, code, "Telegram", msg); // send the function result to the caller
                            });
                        } else {
                            const msg = "The user seems to be busy. We won't ask about their day for now. active_time = " + active_time + ", steps = " + steps;
                            logger.info(msg);
                            // We don't want to ask the user about their day at this point
                            return callback(false, 200, "Telegram", msg);
                        }



                    });

                } else {
                    msg = "It's not the right time to ask about their day";
                    logger.info(msg);
                    // We don't want to ask the user about their day at this point
                    return callback(false, 200, "Telegram", msg);
                } // end check for current time within window

            }); // end getAwokenTime() callback
        }
    });

});

// function to send a message to the users chat
function telegramRequest(userID, timestamp, callback) {
    api.getbotDetails(userID, function(botDetails) {
        if (botDetails === null) {
            return callback(false, "We don't have the users Telegram info. No message has been sent");
        }
        let msg = "";
        let emojis = ["\uD83D\uDE01", "\uD83D\uDE0A", "\uD83D\uDE0C","\uD83D\uDE14","\uD83D\uDE2B"];

        // We want to pass timestamp_midnight to telegram so that they can store the DailyMood at the correct date

        const json = { "chat_id" : botDetails.chat_id,
            "text" : "How was your day today?",
            "force_reply" : "True",
            "reply_markup": {"inline_keyboard": [
                [
                    {"text" : emojis[0], "callback_data" : "{\"timestamp\": \"" + timestamp + "\", \"caller\": \"updateMoves\", \"mood\": 5}"},
                    {"text" : emojis[1], "callback_data" : "{\"timestamp\": \"" + timestamp + "\", \"caller\": \"updateMoves\", \"mood\": 4}"},
                    {"text" : emojis[2], "callback_data" : "{\"timestamp\": \"" + timestamp + "\", \"caller\": \"updateMoves\", \"mood\": 3}"},
                    {"text" : emojis[3], "callback_data" : "{\"timestamp\": \"" + timestamp + "\", \"caller\": \"updateMoves\", \"mood\": 2}"},
                    {"text" : emojis[4], "callback_data" : "{\"timestamp\": \"" + timestamp + "\", \"caller\": \"updateMoves\", \"mood\": 1}"}
                ]
            ]}
        };

        telegram.sendTelegramMessage(json, function(error, message) {
            if (error) {
                msg = 'telegramRequest() :  problem with request: ' + message;
                logger.error(msg);
                return callback(true, msg);
            }
            msg = "A day request message has been sent to the user";
            logger.info("telegramRequest() : " + msg);
            return callback(false, msg)
        });
    });


}

module.exports = router;