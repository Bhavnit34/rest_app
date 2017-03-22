// Dependencies
var sha1 = require("sha1");
var loggerModule = require('../../logger');
// AWS dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();
var logger = loggerModule.getLogger();
module.exports = {

    // change empty strings within json data.items to null as db doesn't allow it
    clearEmptyItemStrings: function(json, size) {
        for (var i = 0; i < size; i++) {
            for (var key in json[i]) {
                var attrName = key.toString();
                var value = json[i][attrName];
                if (value == "") {
                    json[i][attrName] = null
                }
            }
        }
        return json;
    },

    // clear any empty strings within json data to null as db doesn't allow it
    clearEmptyDataStrings: function(json) {
        for (var key in json) {
            var attrName = key.toString();
            var value = json[attrName];
            if (value == "") {
                json[attrName] = null
            }
        }

        return json;
    },

    // used as a template for returning useful information to the caller
    newReturnJson: function() {
        let json =
            {
                Jawbone: {
                    message : "",
                    error : false
                },
                DynamoDB: {
                    message : "",
                    error : false
                },
                Telegram: {
                    message : "",
                    error : false
                }
            };
        return json;
    },

    // used as a template for storing WeeeklyStats data
    newWeeklyStatsJson: function() {
        let json =
            {
                HeartRate: {avg: null},
                Mood: {avg: null},
                Moves: {
                    Steps: {avg: null},
                    Distance: {avg: null},
                    Calories: {avg: null},
                    Active_time: {avg: null}
                },
                Sleep: {
                    AwakeDuration: {avg: null},
                    AsleepTime: {avg: null},
                    AwakeTime: {avg: null},
                    Light: {avg: null},
                    REM: {avg: null},
                    Deep: {avg: null},
                    Duration: {avg: null}
                },
                Workouts: {
                    Count: {count: null},
                    Intensity: {avg: null},
                    Calories: {avg: null},
                    Time: {avg: null}
                }
            };
        return json;
    },

    // checks that the input token matches the one in the DB for a given user
    authenticateToken: function(token, user_id, callback_proceed) {
        var hashedToken = sha1(token);
        // Retrieve data from db
        var params = {
            TableName: "User",
            KeyConditionExpression: 'user_id = :user_id',
            ExpressionAttributeValues: {
                ':user_id': user_id
            },
            Limit: 1
        };

        docClient.query(params, function(err, data) {
            if (err) {
                logger.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                if (data.Items[0].token_hash == hashedToken){
                    return callback_proceed(true);
                } else {
                    return callback_proceed(false);
                }
            }
        });

    },

    // pads a number with zeros. Taken from stack overflow
    pad: function(n, width, z) {
        z = z || '0';
        n = n + '';
        return n.length >= width ? n : new Array(width - n.length + 1).join(z) + n;
    },

    // returns the Telegram Bot API details needed to interact with a user via the Telegram chat
    getbotDetails: function(userID, callback) {
        const params = {
            TableName: "User",
            Key:{"user_id": userID}
        };
        docClient.get(params, function(err, data) {
            if (err) {
                logger.error("getbotAPI() : Unable to read User item. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                if (data.Item.hasOwnProperty('botAPI') && data.Item.hasOwnProperty('chat_id')) {
                    const botDetails = {botAPI: data.Item.botAPI, chat_id: data.Item.chat_id};
                    return callback(botDetails);
                } else {
                    // we don't have their telegram details
                    return callback(null);
                }
            }
        });
    },

    // function to return the moves data for today
    getRecentActiveTime: function(userID, callback) {
        let msg = "";
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

        // read the Moves table
        docClient.query(params, function (err, data) {
            if (err) {
                msg = "getTodaysMoves() : Unable to read Moves item. Error JSON:" + JSON.stringify(err, null, 2);
                logger.error(msg);
                return callback(true, msg, null);
            } else {
                if (data.Count == 0) {
                    msg = "getTodaysMoves() : No Moves info found for today";
                    return callback(false, msg, null);
                }
                let now = new Date();
                let date = data.Items[0].date;
                let dateString = date.substr(0,4) + date.substr(5,2) + date.substr(8,2);
                let move = data.Items[0].info;
                let hour = module.exports.pad(now.getHours().toString(), 2);
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
                        hour = module.exports.pad(hour, 2).toString();
                        hourly_total = dateString + hour;
                    }
                }

                return callback(false, null, {"active_time" : active_time, "steps" :steps});
            }
        });
    }
};


