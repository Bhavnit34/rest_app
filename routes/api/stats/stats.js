// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let api = require('./../api');
let loggerModule = require('../../logger');
let telegram = require ('../telegram/telegram');
let request = require('request');
// AWS Dependencies
let AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
let docClient = new AWS.DynamoDB.DocumentClient();
let logger = loggerModule.getLogger();

router.get('/test', function(req,res){res.status(200).send('stats working');});

// function to return stored stats data
router.get('/:userId/', function(req, res) {
    let table = "Stats";
    let user_id = "";
    let returnJson = api.newReturnJson();
    let limit = 1;
    let attrValues = {};
    let token = "";

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
        token = req.query.token;
    }

    // continue only if token is authenticated
    api.authenticateToken(token, user_id, false, function(authenticated) {

        if (authenticated === false) {
            returnJson.DynamoDB.message = "Authenication Failed";
            returnJson.DynamoDB.error = true;
            return res.status(401).send(returnJson);
        }


        // create query and append attributes if requested
        let query = "user_id = :user_id";
        attrValues[':user_id'] = user_id;

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
                res.status(200).send(JSON.stringify(data, null, 2));
            }
        });
    });

});

// function to return stored weekly stats data
router.get('/weeklyStats/:userId/', function(req, res) {
    let table = "WeeklyStats";
    let user_id = "";
    let returnJson = api.newReturnJson();
    let limit = 10;
    let attrValues = {};
    let token = "";

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
        token = req.query.token;
    }

    // continue only if token is authenticated
    api.authenticateToken(token, user_id, false, function(authenticated) {

        if (authenticated === false) {
            returnJson.DynamoDB.message = "Authenication Failed";
            returnJson.DynamoDB.error = true;
            return res.status(401).send(returnJson);
        }


        // add startDate to query if given
        let startDate = null;
        if (req.query.startDate) {
            if (!isNaN(Date.parse(req.query.startDate))) {
                startDate = req.query.startDate;
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
        if (req.query.endDate) {
            if (!isNaN(Date.parse(req.query.endDate))) {
                // get the end of this day by getting the next day and minusing 1 off the UNIX timestamp
                endDate = req.query.endDate;
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
            query += " AND timestamp_weekStart BETWEEN :startStamp AND :endStamp"; //results between dates
        } else if (startDate) {
            query += " AND timestamp_weekStart >= :startStamp"; // show dates going forwards from startDate
        } else if (endDate) {
            query += " AND timestamp_weekStart <= :endStamp"; // show dates going backwards from endDate
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
                //console.log("GetItem succeeded:", JSON.stringify(data, null, 2));
                res.status(200).send(JSON.stringify(data, null, 2));
            }
        });
    });

});

module.exports = router;

