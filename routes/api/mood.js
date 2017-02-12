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
    res.send('mood working');
    logger.info("logger working");
});

// function to return stored mood data
router.get('/:userId/', function(req, res) {
    var table = "Mood";
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
            query += " AND #timestamp BETWEEN :startStamp AND :endStamp"; //results between dates
        } else if (startDate) {
            query += " AND #timestamp >= :startStamp"; // show dates going forwards from startDate
        } else if (endDate) {
            query += " AND #timestamp <= :endStamp"; // show dates going backwards from endDate
        }

        // Retrieve data from db
        var params = {
            TableName: table,
            KeyConditionExpression: query,
            ExpressionAttributeValues: attrValues,
            Limit: limit,
            ExpressionAttributeNames: {
                "#timestamp": "timestamp"
            }
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
router.post('/updateMood', function(req,res_body){
    var path = '/nudge/api/v.1.1/users/@me/mood?';
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
                // handle empty mood return from Jawbone
                if (Object.keys(json_res.data).length < 1) {
                    returnJson.Jawbone.message = "No mood recorded on this day";
                    returnJson.Jawbone.error = false;
                    return res_body.status(200).send(returnJson);
                }
                json_res.data = api.clearEmptyDataStrings(json_res.data);
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                putMoodEvents();
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


    // Load user info into db
    var putMoodEvents = function () {
        var table = "Mood";
        var user_id = json_res.meta.user_xid;
        var date = json_res.data.date.toString();

        var params = {
            TableName: table,
            Item: {
                "user_id": user_id,
                "timestamp": json_res.data.time_created,
                "date": date.substr(0,4) + "/" + date.substr(4,2) + "/" + date.substr(6,2),
                "info": json_res.data
            }
        };

        // update table
        logger.info("Adding mood " +  date + " for user " + user_id);
        docClient.put(params, function (err, data) {
            if (err) {
                logger.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                returnJson.DynamoDB.error = true;
                return res_body.status(500).send(returnJson);
            } else {
                logger.info("item added");
                returnJson.DynamoDB.message = "SUCCESS";
                returnJson.DynamoDB.error = false;
                return res_body.status(200).send(returnJson);
            }
        });

    }

});

module.exports = router;