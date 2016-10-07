var express = require('express');
var app = express();
var fs = require('fs');
var path = require('path');
var crypto = require ("crypto");

app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, 'views/info.html'));
});


app.listen(3000, function () {
    console.log('Batch service listening on port 3000!');
});
