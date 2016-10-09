var express = require('express');
var app = express();
var fs = require('fs');
var path = require('path');
var crypto = require ("crypto");
var jsonrequest = require('request-json');
var request = require('request');
var md5 = require('md5');

var webapp_env = {
    host : process.env.WEBAPP_PORT_3000_TCP_ADDR || "localhost", 
    port : process.env.WEBAPP_PORT_3000_TCP_PORT || 32000 };
var convsvc_env = {
    host : process.env.CONVSVC_PORT_3000_TCP_ADDR || "localhost", 
    port : process.env.CONVSVC_PORT_3000_TCP_PORT || 32400 };
var indexsvc_env = {
    host : process.env.INDEXSVC_PORT_3000_TCP_ADDR || "localhost", 
    port : process.env.INDEXSVC_PORT_3000_TCP_PORT || 32600 };
var blobsvc_env = {
    host : process.env.BLOBSVC_PORT_3000_TCP_ADDR || "localhost", 
    port : process.env.BLOBSVC_PORT_3000_TCP_PORT || 32600 };

app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, 'views/info.html'));
});

app.get('/run', function(req, res) {
    /*
     Load the time stamp from the previous run. Remember 'current time'
     Get PDF files newer than [time stamp] from the web application
     Convert the PDF to plain text using the convert service
     Compute an MD5 checksum from the text. This is used as document ID.
     Create a JSON document, {
                    id = [MD5 checksum as hex string], 
                    title = [file name],
                    content = [plain text content]
                    }
     Post the JSON document to the /upload endpoint of the index service
     Create a new JSON document, {
                    name = [MD5 checksum as hex string],
                    content = [Base 64 representation of the PDF file]
                    }
     Post the JSON document to the /store endpoint of the blob service
     Ask the web app to remove all files older than [time stamp]
     Save [current time] as recorded in the beginning and store as [time stamp]
    */

    // Load the time stamp from the previous run. Remember 'current time'
    var current_time = Date.now();
    var mtime = new Date(0);
    try {
        mtime = Date.parse(fs.statSync(path.join(__dirname, 'tmp', '.timestamp')).mtime);
        console.log("Last successful run at: " + mtime);
    } catch(err) {
        console.log("Could not read timestamp file, using: " + mtime);
    }

    // Get PDF files newer than [time stamp] from the web application
    var client = jsonrequest.createClient('http://' + webapp_env.host + ':' + webapp_env.port + '/');
    client.get('service/uploads' , function(err, svcres, body) {
        console.log(body);
        for(i in body) {
            console.log(body[i].name);
            var docurl = 'http://' + webapp_env.host + ':' + webapp_env.port + '/service/uploads/' + encodeURIComponent(body[i].name);
            var convurl = 'http://' + convsvc_env.host + ':' + convsvc_env.port + '/convert';
            var docfile = md5(docurl);
            var docfilepath = path.join(__dirname, 'tmp', docfile);
            var txtfilepath = path.join(__dirname, 'tmp', docfile + '_');
            var docfilestream = fs.createWriteStream(docfilepath);
            var txtfilestream = fs.createWriteStream(txtfilepath);
            request
                .get(docurl)
                .on('response', function(response) {
                    console.log("Temporary file name: " + docfile);
                    console.log("File service response status: " + response.statusCode);
                    console.log("Content type: " + response.headers['content-type']);
                })
                .pipe(docfilestream);
            docfilestream.on('finish', function() {
                // Convert the PDF to plain text using the convert service
                console.log("Written");
                var sourcestream = fs.createReadStream(docfilepath);
                sourcestream.pipe(
                    request
                    .post(convurl)
                    .on('response', function(response) {
                        console.log("Content type: " + response.headers['content-type']);
                    })
                    .pipe(txtfilestream)
                );
            });
            txtfilestream.on('finish', function() {
                console.log("Textfile written")
            });
        }
    });

});


app.listen(3000, function () {
    console.log('Batch service listening on port 3000!');
});
