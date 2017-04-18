// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let request = require('request');
let loggerModule = require('../../logger');
let api = require('../api');
let telegram = require('../telegram/telegram');
// AWS Dependencies
let AWS = require('aws-sdk');
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
const docClient = new AWS.DynamoDB.DocumentClient();
const logger = loggerModule.getLogger();
const app_id = "52707ab3fe6eab6fd0360c2f5a0cef93";

// function to check for recent workouts and associate weather information with it
router.post('/updateWorkoutWeather', function(req,res_body){
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

    api.authenticateToken(token, userID, false, function() {
        // retrieve the latest workout
        let workout = {};
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
                msg = ("updateWorkoutWeather() : Error reading Workouts table. Error JSON: " + JSON.stringify(err, null, 2));
                logger.error(msg);
                return callback(true, 500, "DynamoDB", msg);
            }
            if (data.Count === 0) {
                msg = ("updateWorkoutWeather() : Could not find a workout for today.");
                logger.info(msg);
                return callback(false, 200, "DynamoDB", msg);
            }

            // now we need to take the latest workout as the one to work from. (There may be multiple workouts for 1 day)
            workout = data.Items[data.Items.length - 1];

            // ensure the workout doesn't already exist, if it does then check if there were any more, and ask about them
            let i = data.Items.length - 1;
            while (i >= 0) {
                workout = data.Items[i];
                if (workout.hasOwnProperty('weather')) {
                    i--;
                } else {
                    break;
                }
            }

            if (i === -1) { // if we looped through all the workouts and eventually broke the loop
                msg = "We already know the weather during this workout";
                logger.info(msg);
                return callback(false, 200, "DynamoDB", msg);
            }

            // check that the weather was not too long ago
            logger.info("Checking if the user has recently completed a workout...");
            let finishTime = new Date(workout.timestamp_completed * 1000);
            let now = new Date();


            // check that the user worked out at most 3 hours ago
            if (now.getTime() - finishTime.getTime() <= 10800000) {
                // grab the latest weather and assign it to the row
                let lat = workout.info.place_lat;
                let long = workout.info.place_lon;
                requestWeather(lat, long, function(error, message, weather) {
                    if (error) {
                        msg = "updateWorkoutWeather() : error getting weather. Error: " + message;
                        logger.error(msg);
                        return callback(true,500,"OpenWeather",msg);
                    }

                    // store the data
                    putWeatherIntoWorkout(workout.user_id, workout.timestamp_completed, weather, function(error, message){
                        if (error) {
                            msg = "updateWorkoutWeather() : Error updating workout with weather : " + message;
                            logger.error(msg);
                            return callback(true, 500, "DynamoDB", msg);
                        }

                        msg = "Weather information successfully added to workout";
                        logger.info(msg);
                        return callback(false, 200, "DynamoDB", msg);
                    })

                });

            } else {
                msg = "It has been too long since the workout, which finished at " + finishTime.toLocaleString();
                logger.info(msg);
                // We don't want to ask the user about their workout at this point
                return callback(false, 200, "Telegram", msg);
            }



        });

    });
});

function requestWeather(long, lat, callback) {
    let msg = "";
    let coords = "lat=" + lat + "&lon=" + long;
    let url = 'http://api.openweathermap.org/data/2.5/weather?' +  coords
    logger.info("requesting weather: " + url);
    url +=  "&APPID=" + app_id;
    request({
        url: url,
        method: "GET",
        headers: {"content-type" : "application/json"}
    }, function(err, res, body){
        if(err) {
            msg = 'problem with request: ' + e.message;
            logger.error(msg);
            return callback(true, msg, null);
        }
        if(res.statusCode != 200) {
            msg = "requestWeather() : OpenWeatherMaps returned a non 200 response code, " + JSON.stringify(weather, null, 2);
            logger.error(msg);
            return callback(true, msg, null);
        }

        // change empty strings to null, as DynamoDB doesn't allow empty strings
        let weather = body.toString().replace(/\"\"/g, null);
        json = JSON.parse(weather);
        
        return callback(false, null,json);
    });
}

function putWeatherIntoWorkout(userID, timestamp, weather, callback) {
    let msg = "";
    const params = {
        TableName : "Workouts",
        Key : {"user_id" : userID, "timestamp_completed" : timestamp},
        UpdateExpression: "set weather = :weather",
        ExpressionAttributeValues: {":weather" : weather}
    };

    // update dynamo table
    docClient.update(params, function(err, data) {
        if (err) {
            msg = "Error updating Workouts table. Error JSON:" +  JSON.stringify(err, null, 2);
            logger.error(msg);
            return callback(true, msg);
        } else {
            msg = "Workout updated with weather!";
            return callback(false, msg);
        }
    });
}

module.exports = router;



