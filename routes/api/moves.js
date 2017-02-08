// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
var api = require('./api');
var loggerModule = require('../logger');
// AWS Dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();
var logger = loggerModule.getLogger();


router.get('/test', function(req,res){
    res.send('moves working');
    logger.info("new logger working");
});

// function to return all moves
router.get('/:userId/', function(req,res){
    var table = "Moves";
    var user_id = "";
    var returnJson = api.newReturnJson();
    var limit = 10;

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

        // Retrieve data from db
        var params = {
            TableName: table,
            KeyConditionExpression: 'user_id = :user_id',
            ExpressionAttributeValues: {
                ':user_id': user_id
            },
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
router.post('/updateMoves', function(req,res_body){
    // make a jawbone REST request for moves info
    var path = '/nudge/api/v.1.1/users/@me/moves?';
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
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                putMoves();
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


    // Load moves info into db
    var putMoves = function () {
        var table = "Moves";
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
            var formattedDate = date.substr(0,4) + "/" + date.substr(4,2) + "/" + date.substr(6,2);
            var params = {
                TableName: table,
                Item: {
                    "user_id": user_id,
                    "timestamp_completed": json_res.data.items[i].time_completed,
                    "date": formattedDate,
                    "info": json_res.data.items[i]
                }
            };

            var updateCallback = function (){
                // update table
                logger.info("Adding moves " + (i+1) + " --> " +  date + " for user " + user_id);
                docClient.put(params, function (err, data) {
                    if (err) {
                        logger.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                    } else {
                        ++successCount;
                    }
                    updateDB(i+1);
                });
            };


            // delete any old data for the same day
            deleteOldData(table, formattedDate, user_id, updateCallback);


        }

        // start at the first index, the function will iterate over all indexes synchronously until complete and return.
        updateDB(0);

        }


});

// function to remove any old rows of a given day that are now out of date (given the update of new data)
function deleteOldData(table, date, user_id, updateCallback) {
    // query the table for current data on the given date
    var params = {
        TableName: table,
        KeyConditionExpression: 'user_id = :user_id',
        FilterExpression: '#mydate = :date',
        ExpressionAttributeValues: {
            ':user_id': user_id,
            ':date': date
        },
        ExpressionAttributeNames: {
            "#mydate": "date"
        }
    };

    docClient.query(params, function(err, data) {
        if (err) {
            logger.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
        } else {
            var res = data;
            if (res.Count <= 0) {return updateCallback();} // return if there is no data to delete
            // now delete any data that exists for this day
            function deleteData(i, nextDeleteCallback) {
                var userId = res.Items[i].user_id;
                var timestamp = res.Items[i].timestamp_completed;
                var delParams = {
                    TableName: table,
                    Key: {
                        "user_id": userId,
                        "timestamp_completed": timestamp
                    }
                };
                docClient.delete(delParams, function (err, data) {
                    if (err) {
                        logger.error("Unable to delete item. Error JSON:", JSON.stringify(err, null, 2))
                    } else {
                        logger.debug("Deleted old data --> " + user_id + ", " + date);
                        return nextDeleteCallback();
                    }
                })
            }

            var i = 0;
            var nextDeleteCallback = function() {
                i++;
                if (i < res.Items.length) {
                    deleteData(i, nextDeleteCallback);
                } else {
                    // we have deleted all of the data for this day, return
                    return updateCallback();
                }
            };
            deleteData(i, nextDeleteCallback);


        }
    })


}

module.exports = router;