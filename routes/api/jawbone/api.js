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

    newReturnJson: function() {
        var json =
            {
                Jawbone: {
                    message : "",
                    error : false
                },
                DynamoDB: {
                    message : "",
                    error : false
                }
            };
        return json;
    },

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

    }
};


