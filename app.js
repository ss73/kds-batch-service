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
     1. Load the time stamp from the previous run. Remember 'current time'
     2. Get PDF files newer than [time stamp] from the web application
     3. Convert the PDF to plain text using the convert service
     4. Compute an MD5 checksum from the text. This is used as document ID.
     5. Create a JSON document, {
                    id = [MD5 checksum as hex string], 
                    title = [file name],
                    content = [plain text content]
                    }
        Post the JSON document to the /upload endpoint of the index service

     6. Create a new JSON document, {
                    name = [MD5 checksum as hex string],
                    content = [Base 64 representation of the PDF file]
                    }
        Post the JSON document to the /store endpoint of the blob service
     
     7. Ask the web app to remove all files older than [time stamp]
     8. Save [current time] as recorded in the beginning and store as [time stamp]
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
            var documenttitle = body[i].name;
            console.log(documenttitle);
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
                console.log("Written PDF file");
                var formdata = {
                    // Convert service form expects the file in parameter 'pdffile'
                    pdffile : fs.createReadStream(docfilepath)
                };
                request.post({url : convurl, formData : formdata}).pipe(txtfilestream);
            });
            txtfilestream.on('finish', function() {
                console.log("Textfile written");
                fs.readFile(txtfilepath, function (err,data) {
                    if(err) return console.log(err);
                    var indexfile = { 
                        id: md5(data),
                        title: documenttitle,
                        content: new String(data)};
                    console.log(indexfile.title);
                    var indexclient = jsonrequest.createClient('http://' + indexsvc_env.host + ':' + indexsvc_env.port + '/');
                    indexclient.post('/upload', indexfile , function(err, svcres, body) {
                        console.log("Index service response: " + body);
                    });
                    fs.readFile(docfilepath, function(err, data) {
                        if(err) return console.log("Docfile error: " + err);
                        var blobfile = {
                            name: indexfile.id,
                            content: data.toString('base64') 
                        };
                        var blobclient = jsonrequest.createClient('http://' + blobsvc_env.host + ':' + blobsvc_env.port + '/');
                        blobclient.post('/store', blobfile , function(err, svcres, body) {
                            if(err) return console.log("Blob store error: " + err);
                            console.log("Blob service response: " + body);
                        });
                    });
                });
            });
        }
    });

});


app.listen(3000, function () {
    console.log('Batch service listening on port 3000!');
});
