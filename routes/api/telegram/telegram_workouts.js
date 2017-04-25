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



// function to determine if the user has recently completed a workout, and if so, ask about it with Telegram
router.post('/askAboutWorkout', function(req,res_body){
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
        let workout = {};
        // retrieve the latest workout
        let today = new Date();
        today.setHours(0,0,0,0);
        let timestamp = parseInt(today.getTime().toString().substr(0,10));
        const params = {
            TableName : "Workouts",
            KeyConditionExpression: "user_id = :user_id AND timestamp_completed > :timestamp",
            ExpressionAttributeValues: { ":user_id" : userID, ":timestamp" : timestamp }
        };

        // Query the Workouts table for todays workouts
        docClient.query(params, function(err, data) {
            if (err) {
                msg = ("askAboutWorkout() : Error reading Workouts table. Error JSON: " + JSON.stringify(err, null, 2));
                logger.error(msg);
                return callback(true, 500, "DynamoDB", msg);
            }
            if (data.Count === 0) {
                msg = ("askAboutWorkout() : Could not find a workout for today.");
                logger.info(msg);
                return callback(false, 200, "DynamoDB", msg);
            }

            // now we need to take the latest workout as the one to work from. (There may be multiple workouts for 1 day)
            workout = data.Items[data.Items.length - 1];



            // ensure the workout doesn't already exist, if it does then check if there were any more, and ask about them
            let i = data.Items.length - 1;
            while (i >= 0) {
                workout = data.Items[i];
                if (workout.hasOwnProperty('mood')) {
                    i--;
                } else {
                    ask();
                    break;
                }
            }

            if (i === -1) { // if we looped through all the workouts and eventually broke the loop
                msg = "The user has already given us their workout summary";
                logger.info(msg);
                return callback(false, 200, "DynamoDB", msg);
            }


        });


        let ask = function() {
            logger.info("Checking if the user has recently completed a workout...");
            let finishTime = new Date(workout.timestamp_completed * 1000);
            let now = new Date();


            // check that the user worked out at most 3 hours ago
            if (now.getTime() - finishTime.getTime() <= 10800000) {
                // now check active time; by this point the user finished at most 3 hours ago
                // we want to ensure they are active but not too busy
                api.getRecentActiveTime(userID, function (err, msg, activity) {
                    if (err) {
                        return callback(true, 500, "DynamoDB", msg);
                    }
                    if(activity === null) { // if we couldn't find a moves row
                        return callback(false, 200, "DynamoDB", msg);
                    }

                    if (activity.steps >= 0 && activity.active_time <= 300) {
                        logger.info("User is currently active. Asking about their workout...");
                        // the user is awake and active. Ask about their workout
                        telegramRequest(userID, workout.info.title, workout.timestamp_completed, function (error, msg) {
                            let code = error ? 500 : 200;
                            return callback(error, code, "Telegram", msg); // send the function result to the caller
                        });
                    } else {
                        msg = "The user does not seem available. We won't ask them about their workout. (activity = " + JSON.stringify(activity) + ")";
                        logger.info(msg);
                        // We don't want to ask the user about their workout at this point
                        return callback(false, 200, "Telegram", msg);
                    }
                });

            } else {
                msg = "It has been too long since the workout, which finished at " + finishTime.toLocaleString();
                logger.info(msg);
                // We don't want to ask the user about their workout at this point
                return callback(false, 200, "Telegram", msg);
            }
        }
    });

});

// function to send a message to the users chat
function telegramRequest(userID, title, timestamp, callback) {
    api.getbotDetails(userID, function(botDetails) {
        let msg = "";
        if (botDetails === null) { return callback(false, "We don't have the users Telegram info. No message has been sent");}

        let json = { "chat_id" : botDetails.chat_id,
            "text" : "It looks like you recently did some excercise. ( " + title + " ). How tired do you feel now?",
            "force_reply" : "True",
            "reply_markup": {"inline_keyboard": [
                [{"text" : "Energised", "callback_data" : "{\"caller\": \"wo\", \"mood\": 5, \"timestamp\": \"" + timestamp + "\"}"}],
                [{"text" : "Good", "callback_data" : "{\"caller\": \"wo\", \"mood\": 4, \"timestamp\": \"" + timestamp + "\"}"}],
                [{"text" : "Holding up OK", "callback_data" : "{\"caller\": \"wo\", \"mood\": 3, \"timestamp\": \"" + timestamp + "\"}"}],
                [{"text" : "Somewhat tired", "callback_data" : "{\"caller\": \"wo\", \"mood\": 2, \"timestamp\": \"" + timestamp + "\"}"}],
                [{"text" : "Falling asleep", "callback_data" : "{\"caller\": \"wo\", \"mood\": 1, \"timestamp\": \"" + timestamp + "\"}"}]
            ]}
        };


        telegram.sendTelegramMessage(userID, json, function(error, message) {
            if (error) {
                msg = 'telegramRequest() :  problem with request: ' + message;
                logger.error(msg);
                return callback(true, msg);
            }
            msg = "A workout request message has been sent to the user";
            logger.info("telegramRequest() : " + msg);
            return callback(false, msg)
        });
    });

}

module.exports = router;