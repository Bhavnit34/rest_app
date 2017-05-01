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

// function to check if the targetted sleep has had feedback associated with it
function checkMoodExists(userID, timestamp, callback) {
    let msg = "";
    const params = {
        TableName : "Sleeps",
        Key: {
            "user_id" : userID,
            "timestamp_completed" : timestamp
        }
    };

    docClient.get(params, function(err, data) {
        if (err) {
            msg = "checkMoodExists() : Unable to read Sleep item. Error JSON:" + JSON.stringify(err, null, 2);
            logger.error(msg);
            return callback(true, false);
        } else {
            const sleep = data.Item;
            if (sleep.hasOwnProperty('mood')){
                return callback(false, true);
            } else {
                return callback(false, false);
            }
        }
    });
}

// function to determine if the user has recently woken up and if so, ask about their sleep using Telegram
router.post('/askAboutSleep', function(req,res_body){
    let userID = "";
    let token = "";
    let returnJson = api.newReturnJson();
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

    // authenticate before proceeding
    api.authenticateToken(token,userID,false,function() {
        let sleep = {};
        // retrieve the latest sleep
        let today = new Date();
        today.setHours(0,0,0,0);
        let timestamp = parseInt(today.getTime().toString().substr(0,10));
        const params = {
            TableName : "Sleeps",
            KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
            ExpressionAttributeValues: { ":user_id" : userID, ":timestamp" : timestamp }
        };

        // Query the Sleeps table for todays sleep
        docClient.query(params, function(err, data) {
            if (err) {
                msg = ("askAboutSleep() : Error reading Sleeps table. Error JSON: " + JSON.stringify(err, null, 2));
                logger.error(msg);
                return callback(true, 500, "DynamoDB", msg);
            }
            if (data.Count === 0) {
                msg = ("askAboutSleep() : Could not find a sleep for today.");
                logger.info(msg);
                return callback(false, 200, "DynamoDB", msg);
            }

            // now we need to take the longest sleep as the one to work from. (There may be multiple sleeps for 1 day)
            let max_duration = 0;
            let max_index = 0;
            for (let i = 0; i < data.Items.length; i++) {
                let sleep_row = data.Items[i].info.details;
                if (sleep_row.duration > max_duration) {
                    max_duration = sleep_row.duration;
                    max_index = i;
                }
            }

            // the sleep we are looking at is set as the one that lasted the longest
            sleep = data.Items[max_index].info;

            // ensure the mood doesn't already exist
            checkMoodExists(userID, sleep.time_completed, function(error, exists) {
                if (error) {
                    msg = "askAboutSleep() : could not get mood information from the sleep";
                    logger.error(msg);
                    return callback(true, 500, "DynamoDB", msg);
                }
                if (exists) {
                    msg = "The user has already given us their sleep summary";
                    logger.info(msg);
                    return callback(false, 200, "DynamoDB", msg);
                } else {
                    ask();
                }
            });
        });




        let ask = function() {
            logger.info("Checking if the user has recently awoken...");
            let activeTime = 0;
            let awakeTime = new Date(sleep.details.awake_time * 1000);
            let now = new Date();
            let wokenHour = api.pad(awakeTime.getHours(), 2);


            // check that the user woke up at most 3 hours ago
            if (now.getTime() - awakeTime.getTime() <= 10800000) {
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

                // read the Moves table and find recent active time and steps
                docClient.query(params, function (err, data) {
                    if (err) {
                        msg = "askAboutSleep() : Unable to read Moves item. Error JSON:" + JSON.stringify(err, null, 2);
                        logger.error(msg);
                        return callback(true, 500, "DynamoDB", msg);
                    } else {
                        let move = data;

                        // end if we don't have any moves info
                        if (data.Count === 0) {
                            msg = "askAboutSleep(): no Moves information available";
                            logger.info(msg);
                            return callback(false, 200, "DynamoDB", msg);
                        }

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
                            if (move.Items[0].info.details.hourly_totals.hasOwnProperty(hourlyString)) {
                                activeTime = move.Items[0].info.details.hourly_totals[hourlyString].active_time;
                                break;
                            } else {
                                hour--;
                            }
                        }

                        // now check active time; by this point the user woke up at most 3 hours ago
                        // we want to ensure they are active but not too busy
                        if (activeTime >= 10 && activeTime <= 400) {
                            logger.info("User is currently active. Asking about their sleep...");
                            // the user is awake and active. Ask about their sleep
                            telegramRequest(userID, function (error, msg) {
                                let code = error ? 500 : 200;
                                return callback(error, code, "Telegram", msg); // send the function result to the caller
                            });
                        } else {
                            const msg = "The user does not seem available. We won't ask them about their sleep. (active time = " + activeTime + ")";
                            logger.info(msg);
                            // We don't want to ask the user about their sleep at this point
                            return callback(false, 200, "Telegram", msg);
                        }
                    }
                });

            } else {
                const msg = "The user has not recently awoken. They last awoke at " + awakeTime.toString().split(" ").slice(0, 5).join(" ");
                logger.info(msg);
                // We don't want to ask the user about their sleep at this point
                return callback(false, 200, "Telegram", msg);
            }
        };
    });

});

// function to send a message to the users chat
function telegramRequest(userID, callback) {
    api.getbotDetails(userID, function(botDetails) {
        if (botDetails === null) {
            return callback(false, "We don't have the users Telegram info. No message has been sent");
        }
        let msg = "";
        let emojis = ["\uD83D\uDE01", "\uD83D\uDE0A", "\uD83D\uDE0C","\uD83D\uDE14","\uD83D\uDE2B"];

        const json = { "chat_id" : botDetails.chat_id,
            "text" : "I've noticed you've started your day. How tired were you when you woke up?",
            "force_reply" : "True",
            "reply_markup": {"inline_keyboard":
                [
                    [{"text" : "Refreshed " + emojis[0], "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 5}"}],
                    [{"text" : "Good " + emojis[1], "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 4}"}],
                    [{"text" : "OK " + emojis[2], "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 3}"}],
                    [{"text" : "Somewhat tired " + emojis[3], "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 2}"}],
                    [{"text" : "Very tired " + emojis[4], "callback_data" : "{\"caller\": \"updateSleeps\", \"mood\": 1}"}]
                ]
            }
        };


        telegram.sendTelegramMessage(json, function(error, message) {
            if (error) {
                msg = 'telegramRequest() :  problem with request: ' + message;
                logger.error(msg);
                return callback(true, msg);
            }
            msg = "A sleep request message has been sent to the user";
            logger.info("telegramRequest() : " + msg);
            return callback(false, msg)
        });

    });

}

module.exports = router;
