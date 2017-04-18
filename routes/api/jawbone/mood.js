// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let api = require('./../api');
let loggerModule = require('../../logger');
// AWS Dependencies
let AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
let docClient = new AWS.DynamoDB.DocumentClient();
let logger = loggerModule.getLogger();

router.get('/test', function(req,res){
    res.status(200).send('mood working');
    logger.info("logger working");
});

// function to return stored mood data
router.get('/:userId/', function(req_body, res) {
    let table = "DailyMood";
    let user_id = "";
    let returnJson = api.newReturnJson();
    let limit = 10;
    let attrValues = {};
    let token = "";

    // check for passed userID
    if (!req_body.params.userId){
        returnJson.DynamoDB.message = "User ID missing!";
        returnJson.DynamoDB.error = true;
        return res.status(400).send(returnJson);
    } else {
        user_id = req_body.params.userId;
    }

    // authenticate token
    if (!req_body.query.token){
        returnJson.DynamoDB.message = "Token missing!";
        returnJson.DynamoDB.error = true;
        return res.status(401).send(returnJson);
    } else {
        token = req_body.query.token;
    }

    // run this after authentication check below
    let proceed = function(authenticated) {

        if (authenticated === false) {
            returnJson.DynamoDB.message = "Authenication Failed";
            returnJson.DynamoDB.error = true;
            return res.status(401).send(returnJson);
        }


        // add limit to query if given
        if (req_body.query.limit) {
            if (!isNaN(req_body.query.limit)) {
                limit = parseInt(req_body.query.limit);
            } else {
                returnJson.DynamoDB.message = "Limit must be an integer";
                returnJson.DynamoDB.error = true;
                return res.status(400).send(returnJson);
            }
        }


        // add startDate to query if given
        let startDate = null;
        if (req_body.query.startDate) {
            if (!isNaN(Date.parse(req_body.query.startDate))) {
                startDate = req_body.query.startDate;
                let startStamp = new Date(startDate).getTime().toString().substr(0,10);
                attrValues[':startStamp'] = parseInt(startStamp);
            } else {
                returnJson.DynamoDB.message = "Invalid startDate";
                returnJson.DynamoDB.error = true;
                return res.status(400).send(returnJson);
            }
        }

        // add endDate to query if given
        let endDate = null;
        if (req_body.query.endDate) {
            if (!isNaN(Date.parse(req_body.query.endDate))) {
                // get the end of this day by getting the next day and minusing 1 off the UNIX timestamp
                endDate = req_body.query.endDate;
                let nextDate =  new Date(endDate);
                nextDate.setDate(nextDate.getDate() + 1);
                let endStamp = new Date(nextDate).getTime().toString().substr(0, 10);
                attrValues[':endStamp'] = parseInt(endStamp) - 1;
            } else {
                returnJson.DynamoDB.message = "Invalid endDate";
                returnJson.DynamoDB.error = true;
                return res.status(400).send(returnJson);
            }
        }


        // create query and append attributes if requested
        let query = "user_id = :user_id";
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
        let params = {
            TableName: table,
            KeyConditionExpression: query,
            ExpressionAttributeValues: attrValues,
            Limit: limit
        };

        docClient.query(params, function (err, data) {
            if (err) {
                logger.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                //logger.log("GetItem succeeded:", JSON.stringify(data, null, 2));
                res.status(200).send(JSON.stringify(data, null, 2));
            }
        });
    };

    // continue only if token is authenticated
    api.authenticateToken(token, user_id, false, proceed);

});

// function to gather the latest data from Jawbone and push to DynamoDB
router.post('/updateMood', function(req_body,res_body){
    let path = '/nudge/api/v.1.1/users/@me/mood?';
    let returnJson = api.newReturnJson();


    // authenticate token
    if (!req_body.body.token){
        returnJson.Jawbone.message = "Token missing!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    }

    // add date to query if given
    if (req_body.body.date){
        if (req_body.body.date.toString().match(/^(\d{4})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/)) { //match YYYYMMDD
            path += "&date=" + req.body.date;
        } else {
            returnJson.Jawbone.message = "Please use date format YYYYMMDD";
            returnJson.Jawbone.error = true;
            return res_body.status(400).send(returnJson);
        }
    }


    let options = {
        host: 'jawbone.com',
        path: path,
        headers: {'Authorization': 'Bearer ' + req.body.token},
        method: 'GET'
    };
    let body = "";
    let json_res = {};
    let req = https.request(options, function(res) {
        logger.debug('JAWBONE HTTP GET RESPONSE: ' + res.statusCode);

        res.on('data', function(d) {
            body += d;
        });
        res.on('end', function() {
            json_res = JSON.parse(body);
            if (res.statusCode !== 200) {
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
    let putMoodEvents = function () {
        let table = "Mood";
        let user_id = json_res.meta.user_xid;
        let date = json_res.data.date.toString();

        let params = {
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