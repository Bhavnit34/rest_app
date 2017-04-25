// Dependencies
let express = require('express');
let router = express.Router();
let https = require('https');
let api = require('../api');
let loggerModule = require('../../logger');
// AWS Dependencies
let AWS = require("aws-sdk");
AWS.config.update({
    region: "eu-west-1",
    endpoint: "https://dynamodb.eu-west-1.amazonaws.com"
});
let docClient = new AWS.DynamoDB.DocumentClient();
let dynamodb = new AWS.DynamoDB();
let logger = loggerModule.getLogger();

router.get('/test', function(req,res){res.status(200).send('jawbone common working');});

// ADMINISTRATIVE function to obtain all values for a given attribute
router.get('/getAllData', function(req, res_body) {
    let attr = "";
    let user_id = "";
    let returnJson = api.newReturnJson();
    let token = "";
    let msg = "";

    // This is where we respond to the request
    let callback = function(error, code, type, msg) {
        returnJson[type].error = error;
        returnJson[type].message = msg;
        return res_body.status(code).send(returnJson);
    };

    // check userId
    if (!req.query.userId) {
        msg = "Missing userId!";
        return callback(true, 400, "Jawbone", msg);
    } else {
        user_id = req.query.userId;
    }

    // authenticate token
    if (!req.query.token) {
        msg = "Token missing!";
        return callback(true, 401, "Jawbone", msg);
    } else {
        token = req.query.token;
    }

    // check for required attribute
    if (!req.query.attribute) {
        msg = "attribute missing!";
        return callback(true, 400, "Jawbone", msg);
    } else {
        attr = req.query.attribute;
    }

    api.authenticateToken(token, user_id, true, function(authenticated) {
        if (authenticated === false) {
            return callback(true, 401, "DynamoDB", "Authentication Failed!");
        }

        const params = {
            TableName : attr,
        };

        docClient.scan(params, function(err, data) {
            if (err) {
                msg = "Could not scan table: " + attr;
                returnJson.Jawbone.error = true;
                returnJson.Jawbone.message = msg;
                logger.error("getAllData(" + attr + ") : JSON.stringify(err, null, 2)");
                return callback(true, 500, "DynamoDB", JSON.stringify(err, null, 2));
            }

            return res_body.status(200).send(data);
        })

    });
});

router.get('/getRowCount', function(req, res_body) {
    let attr = "";
    let user_id = "";
    let returnJson = api.newReturnJson();
    let token = "";
    let msg = "";

    // This is where we respond to the request
    let callback = function(error, code, type, msg) {
        returnJson[type].error = error;
        returnJson[type].message = msg;
        return res_body.status(code).send(returnJson);
    };

    // check userId
    if (!req.query.userId) {
        msg = "Missing userId!";
        return callback(true, 400, "Jawbone", msg);
    } else {
        user_id = req.query.userId;
    }

    // authenticate token
    if (!req.query.token) {
        msg = "Token missing!";
        return callback(true, 401, "Jawbone", msg);
    } else {
        token = req.query.token;
    }

    // check for required attribute
    if (!req.query.attribute) {
        msg = "attribute missing!";
        return callback(true, 400, "Jawbone", msg);
    } else {
        attr = req.query.attribute;
    }

    api.authenticateToken(token, user_id, false, function(authenticated) {
        if (authenticated === false) {
            return callback(true, 401, "DynamoDB", "Authentication Failed!");
        }

        const params = {
            TableName : attr,
        };


        // describe table gives info about the table, including the no. of rows
        dynamodb.describeTable(params, function(err, data) {
            if (err) {
                msg = "Could not describe table: " + attr;
                returnJson.Jawbone.error = true;
                returnJson.Jawbone.message = msg;
                logger.error("getRowCount(" + attr + ") : JSON.stringify(err, null, 2)");
                return callback(true, 500, "DynamoDB", JSON.stringify(err, null, 2));
            }

            return res_body.status(200).send(data);
        })

    });
});

module.exports = router;