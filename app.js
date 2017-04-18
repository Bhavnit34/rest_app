let express = require('express');
let path = require('path');
let favicon = require('serve-favicon');
let logger = require('morgan');
let cookieParser = require('cookie-parser');
let bodyParser = require('body-parser');
let expressWinston = require('express-winston');
let winston = require('winston');
let args = require('./args');
let fs = require('fs');
let app = express();
let cors = require('cors');



// view engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// uncomment after placing your favicon in /public
//app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(bodyParser.urlencoded({extended:true}));
app.use(bodyParser.json());
app.use(logger('dev'));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));
app.use(cors());

// express-winston logger makes sense BEFORE the router.
app.use(expressWinston.logger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true,
            level: args.logLevel
        }),
        new (winston.transports.File)({
            filename: args.logPath + "/rest_app_express.log",
            colorize: true,
            level : args.logLevel
        })
    ],
    exitOnError: false,
    colorize: true,
    requestWhitelist: ["url", "method", "originalURL"]
}));



// Routes
app.use('/', require('./routes/index'));

// jawbone
app.use('/api/jawbone', require('./routes/api/jawbone/jawbone'));
app.use('/api/user', require('./routes/api/jawbone/user'));
app.use('/api/sleeps', require('./routes/api/jawbone/sleeps'));
app.use('/api/moves', require('./routes/api/jawbone/moves'));
app.use('/api/workouts', require('./routes/api/jawbone/workouts'));
app.use('/api/heartrate', require('./routes/api/jawbone/heartrate'));
app.use('/api/body', require('./routes/api/jawbone/body'));
app.use('/api/settings', require('./routes/api/jawbone/settings'));
app.use('/api/mood', require('./routes/api/jawbone/mood'));

// stats
app.use('/api/stats', require('./routes/api/stats/stats'));
app.use('/api/stats/sleeps', require('./routes/api/stats/stats_sleeps'));
app.use('/api/stats/moves', require('./routes/api/stats/stats_moves'));
app.use('/api/stats/workouts', require('./routes/api/stats/stats_workouts'));
app.use('/api/stats/heartrate', require('./routes/api/stats/stats_heartrate'));
app.use('/api/stats/mood', require('./routes/api/stats/stats_mood'));

// telegram
app.use('/api/telegram', require('./routes/api/telegram/telegram'));
app.use('/api/telegram/sleeps', require('./routes/api/telegram/telegram_sleeps'));
app.use('/api/telegram/moves', require('./routes/api/telegram/telegram_moves'));
app.use('/api/telegram/workouts', require('./routes/api/telegram/telegram_workouts'));

// weather
app.use('/api/weather', require('./routes/api/weather/weather'));



// catch 404 and forward to error handler
app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get('env') === 'development' ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render('error');
});

// express-winston errorLogger makes sense AFTER the router.
app.use(expressWinston.errorLogger({
    transports: [
        new winston.transports.Console({
            json: true,
            colorize: true,
            level : args.logLevel
        }),
        new (winston.transports.File)({
            filename: args.logPath + "/rest_app_express.log",
            colorize: true,
            level : args.logLevel
        })
    ],
    exitOnError: false
}));

module.exports = app;
