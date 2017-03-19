// Dependencies
var express = require('express');
var router = express.Router();
var https = require('https');
var api = require('./api');
var loggerModule = require('../../logger');
var sha1 = require('sha1');
// AWS Dependencies
var AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
var docClient = new AWS.DynamoDB.DocumentClient();
var logger = loggerModule.getLogger();

// routes
router.get('/test', function(req,res){
    res.send('user working');
    logger.info("logger working");
});

// function to return stored user data
router.get('/:userId/', function(req,res){
    var table = "User";
    var user_id = "";
    var returnJson = api.newReturnJson();
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

        // create query and append attributes if requested
        var query = "user_id = :user_id";
        attrValues[':user_id'] = user_id;

        // Retrieve data from db
        var params = {
            TableName: table,
            KeyConditionExpression: query,
            ExpressionAttributeValues: attrValues
        };

        docClient.query(params, function (err, data) {
            if (err) {
                console.error("Unable to read item. Error JSON:", JSON.stringify(err, null, 2));
            } else {
                res.send(JSON.stringify(data, null, 2));
            }
        });
    };

    // continue only if token is authenticated
    api.authenticateToken(token, user_id, proceed);

});

// function to gather the latest data from Jawbone and push to DynamoDB
router.post('/addUser', function(req,res_body){
    // make a jawbone REST request for user info
    var path = '/nudge/api/v.1.1/users/@me';
    var returnJson = api.newReturnJson();
    // authenticate token
    if (!req.body.token){
        returnJson.Jawbone.message = "Token missing!";
        returnJson.Jawbone.error = true;
        return res_body.status(401).send(returnJson);
    } else {
       var token = req.body.token;
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
            body += d;
        });
        res.on('end', function() {
            if (res.statusCode != 200) {
                // REST response BAD, output error
                returnJson.Jawbone.message = JSON.stringify(json_res, null, 2);
                returnJson.Jawbone.error = true;
                return res_body.status(res.statusCode).send(returnJson);
            } else {
                json_res = JSON.parse(body);
                returnJson.Jawbone.message = "SUCCESS";
                returnJson.Jawbone.error = false;
                loadUserInfo();
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
    var loadUserInfo = function () {
        var table = "User";
        var user_id = json_res.data.xid;
        json_res.data.image = "none";
        var params = {
            TableName: table,
            Item: {
                "user_id": user_id,
                "info": json_res.data,
                "token_hash": sha1(token) // hash token using SHA-1
            }
        };


        logger.info("Adding a new user: " + user_id);
        docClient.put(params, function (err, data) {
            if (err) {
                logger.error("Unable to add item. Error JSON:", JSON.stringify(err, null, 2));
                returnJson.DynamoDB.message = JSON.stringify(err, null, 2);
                returnJson.DynamoDB.error = true;
                return res_body.status(500).send(returnJson);
            } else {
                logger.info("Added user ---> :" + user_id);
                returnJson.DynamoDB.message = "SUCCESS";
                returnJson.DynamoDB.error = false;
                return res_body.status(200).send(returnJson);
            }
        });
    }

});



//return router
module.exports = router;