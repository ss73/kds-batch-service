var express = require('express');
var app = express();
var fs = require('fs');
var path = require('path');
var crypto = require("crypto");
var jsonrequest = require('request-json');
var request = require('request');
var md5 = require('md5');
var async = require('async');

var webapp_env = {
    host: process.env.WEBAPP_PORT_32000_TCP_ADDR || "localhost",
    port: process.env.WEBAPP_PORT_32000_TCP_PORT || 32000
};
var convsvc_env = {
    host: process.env.CONVSVC_PORT_32400_TCP_ADDR || "localhost",
    port: process.env.CONVSVC_PORT_32400_TCP_PORT || 32400
};
var indexsvc_env = {
    host: process.env.INDEXSVC_PORT_32600_TCP_ADDR || "localhost",
    port: process.env.INDEXSVC_PORT_32600_TCP_PORT || 32600
};
var blobsvc_env = {
    host: process.env.BLOBSVC_PORT_32500_TCP_ADDR || "localhost",
    port: process.env.BLOBSVC_PORT_32500_TCP_PORT || 32500
};

app.get('/', function (req, res) {
    res.sendFile(path.join(__dirname, 'views/info.html'));
});

app.get('/run', function (req, res) {
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
    var starttime = new Date();
    var timefile = path.join(__dirname, 'tmp', '.timestamp');
    console.log("Running at: " + starttime + "\n");
    try {
        mtime = new Date((fs.statSync(timefile)).mtime);
        console.log("Last successful run at: " + mtime);
    } catch (err) {
        console.log("Could not read timestamp file, using: " + mtime);
    }

    // Serially process top level process flow
    async.waterfall([
        getFileList,                // Get list of uploaded files from web application (JSON array of file names)
        processFileList,            // Process the list of files
        async.constant(mtime),      // Async utility method to pass argument
        cleanup
    ], function (err) {
        if (err) {
            console.log("Top level waterfall: " + err);
            return res.send(err)
        }
        res.sendStatus(200);
    });
});

function getFileList(callback) {
    console.log("getFileList");
    // Initiate JSON request to web application service endpoint to list files
    var client = jsonrequest.createClient('http://' + webapp_env.host + ':' + webapp_env.port + '/');
    client.get('service/uploads', function (err, res, body) {
        console.log("Uploads: " + JSON.stringify(body));
        if (err)
            callback(err);
        callback(null, body);
    });
}

function processFileList(files, callback) {
    async.each(files, processFile, function (err) {
        console.log("Last file processed");
        callback(err);
    })
}

function processFile(file, callback) {
    console.log("File: " + file.name);
    async.waterfall([
        async.constant(file.name),      // Async utility method to pass argument to first step in waterfall
        saveTempFile,                   // Save the current file temporarily
        convertToPlaintext,             // Convert the file to plain text and store locally 
        computeChecksum,                // Create an MD5 checksum and the data for the index service
        updateIndex,                    // Update the index
        updateBlobStore,                // Update the blob store with the corresponding file
        cleanupTempFiles,                 // Remove the temporary files
    ], function (err) {
        callback(err);
    })
}

function saveTempFile(file, callback) {
    console.log("saveTempFile, file=" + file);
    var docurl = 'http://' + webapp_env.host + ':' + webapp_env.port + '/service/uploads/' + encodeURIComponent(file);
    var tempname = md5(docurl);         // Returns the MD5 checksum as a hexadecimal string
    var temppath = path.join(__dirname, 'tmp', tempname);
    var filestream = fs.createWriteStream(temppath);
    request
        .get(docurl)
        .on('response', function (response) {
            console.log("Temporary file name for '" + file + "' : " + tempname);
            console.log("File service response status: " + response.statusCode);
            console.log("Content type: " + response.headers['content-type']);
        })
        .pipe(filestream);
    filestream.on('finish', function () {
        callback(null, file.replace(/\.[^/.]+$/, ""), tempname); // Strip file suffix from title
    });
}

function convertToPlaintext(title, tempname, callback) {
    console.log("convertToPlaintext, title=" + title + " file=" + tempname);
    var convurl = 'http://' + convsvc_env.host + ':' + convsvc_env.port + '/convert';
    var srctemppath = path.join(__dirname, 'tmp', tempname);
    var dsttemppath = path.join(__dirname, 'tmp', tempname + '_');
    var filestream = fs.createWriteStream(dsttemppath);
    // Convert service form expects the file in parameter 'pdffile'
    var formdata = {
        pdffile: fs.createReadStream(srctemppath)
    };
    request.post({ url: convurl, formData: formdata }).pipe(filestream);
    filestream.on('finish', function () {
        console.log("Textfile written");
        callback(null, title, tempname);
    });
}

function computeChecksum(title, tempname, callback) {
    console.log("computeChecksum, title=" + title + " tempname=" + tempname);
    var temppath = path.join(__dirname, 'tmp', tempname + '_');
    fs.readFile(temppath, function (err, data) {
        if (err) {
            console.log(err);
            callback(err);
        }
        // Prepare JSON for the indexing service
        var indexrecord = {
            id: md5(data),
            title: title,
            content: new String(data)
        };
        callback(null, indexrecord, tempname);
    });
}

function updateIndex(indexrecord, tempname, callback) {
    console.log("updateIndex, id=" + indexrecord.id + " title=" + indexrecord.title);
    var indexclient = jsonrequest.createClient('http://' + indexsvc_env.host + ':' + indexsvc_env.port + '/');
    indexclient.post('/upload', indexrecord, function (err, svcres, body) {
        if(err) {
            console.log("Index service error: " + err);
        }
        console.log("Index service response: " + body);
        callback(null, indexrecord.id, tempname);
    });
}

function updateBlobStore(id, tempname, callback) {
    console.log("updateBlobStore, id=" + id);
    var temppath = path.join(__dirname, 'tmp', tempname);
    fs.readFile(temppath, function (err, data) {
        if (err) {
            console.log("File error in update blob store: " + err);
            callback(err);
        }
        var blobfile = {
            name: id,
            content: data.toString('base64')
        };
        var blobclient = jsonrequest.createClient('http://' + blobsvc_env.host + ':' + blobsvc_env.port + '/');
        blobclient.post('/store', blobfile, function (err, svcres, body) {
            if (err) {
                console.log("JSON request error in update blob store: " + err);
                callback(err);
            }
            console.log("Blob service updated with id: " + id);
            callback(null, tempname);
        });
    });
}

function cleanupTempFiles(tempname, callback) {
    var bintemppath = path.join(__dirname, 'tmp', tempname);
    var txttemppath = path.join(__dirname, 'tmp', tempname + '_');
    fs.unlink(txttemppath, function (err) {
        if (err) console.log("Failed to cleanup temp file: " + err);
    });
    fs.unlink(bintemppath, function (err) {
        if (err) console.log("Filed to cleanup temp file: " + err);
    });
    callback(null); // Note callback does not wait for files to be deleted    
}

function cleanup(starttime, callback) {
    console.log("Cleanup");
    // Store timestamp
    var timefile = path.join(__dirname, 'tmp', '.timestamp');
    fs.utimes(timefile, starttime, starttime, function (err) {
        if (err) {
            console.log("Filed to update timestamp: " + err);
            callback(err);
        }
        // Remove processed site docs
        var cleanupurl = 'http://' + webapp_env.host + ':' + webapp_env.port + '/service/cleanup/' + encodeURIComponent(starttime);
        request
            .get(cleanupurl)
            .on('response', function (response) {
                console.log("Cleanup response status: " + response.statusCode);
                callback(null);
            });
    });
}

app.listen(32700, function () {
    console.log('Batch service listening on port 32700');
});
