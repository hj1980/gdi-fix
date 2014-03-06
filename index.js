"use strict";

var fs = require('fs');
var RSVP = require('rsvp');
var sqlite3 = require('sqlite3');

var mapOldToNew = {};

RSVP.on('error', function(reason) {
  console.assert(false, reason);
});



var prepare = function() {
  return new RSVP.Promise(function(resolve, reject) {

    var src = new sqlite3.Database('./snapshot.db.orig', sqlite3.OPEN_READONLY, function(err) {
      if (err) return reject(err);

      var dst = new sqlite3.Database('./snapshot.db', function(err) {
        if (err) return reject(err);

        var statements = 'DELETE FROM local_entry; DELETE FROM local_relations; DELETE FROM mapping;';
        dst.exec(statements, function(err) {
          if (err) return reject(err);

          resolve({
            root: root,
            src: src,
            dst: dst
          });

        });

      });
  
    });

  });
};



var locateByInode = function(db, inode) {
  return new RSVP.Promise(function(resolve, reject) {

    db.get('select * from local_entry where inode_number = ?', [inode], function(err, row) {
      if (err) return reject(err);

      return resolve(row);
    });

  });
};



var locateByFilename = function(db, filename) {
  return new RSVP.Promise(function(resolve, reject) {

    db.get('select * from local_entry where filename = ?', [filename], function(err, row) {
      if (err) return reject(err);

      return resolve(row);
    });

  });
};



var getResourceId = function(db, inode) {
  return new RSVP.Promise(function(resolve, reject) {

    db.get('select * from mapping where inode_number = ?', [inode], function(err, row) {
      if (err) return reject(err);

      return resolve(row.resource_id);
    });

  });
};



var listChildren = function(db, inode) {
  return new RSVP.Promise(function(resolve, reject) {

    db.all('select * from local_relations where parent_inode_number = ?', [inode], function(err, rows) {
      if (err) return reject(err);

      return resolve(rows);
    });

  });
};



var statFile = function(filename) {
  return new RSVP.Promise(function(resolve, reject) {
    fs.stat(filename, function(err, stats) {
      if (err) return reject(err);

      return resolve(stats);
    });
  });
};



// given a location (containing folder) and an inode, we can:
// - look up the entry for the inode
// - stat the file (location + filename)
// - build a list of children by looking up the relationships
// - grab the cloud resource id
var doMagic = function(db, location, inode, parent) {
  return new RSVP.Promise(function(resolve, reject) {
    return locateByInode(db, inode).then(function(entry) {

      getResourceId(db, inode).then(function(resourceId) {

        var fullName = location + entry.filename;

        statFile(fullName).then(function(stats) {

          if (parent !== null) {
            mapOldToNew[parent].children.push(stats.ino);
          }

          listChildren(db, inode).then(function(children) {

            mapOldToNew[inode] = {
              location: location,
              entry: entry,
              stats: stats,
              resourceId: resourceId,
              children: [],
              oldchildren: children.map(function(child) { return child.child_inode_number; })
            };

            var promises = children.map(function(child) {
              return new RSVP.Promise(function(resolve, reject) {
                return doMagic(db, fullName + '/', child.child_inode_number, inode).then(resolve, reject);
              });
            });

            return RSVP.all(promises).then(resolve, reject);

          }, reject);

        }, reject);

      }, reject);

    }, reject);

  }); 
};



var createLocalEntry = function(db, mapped) {
  return new RSVP.Promise(function(resolve, reject) {

    db.run('insert into local_entry (inode_number, filename, modified, checksum, size) values ($inode_number, $filename, $modified, $checksum, $size)', {
      $inode_number: mapped.stats.ino,
      $filename: mapped.entry.filename,
      $modified: mapped.entry.modified,
      $checksum: mapped.entry.checksum,
      $size: mapped.entry.size
    }, function(err) {
      if (err) return reject(err);

      resolve();
    });

  });
};



var createLocalRelation = function(db, parent, child) {
  return new RSVP.Promise(function(resolve, reject) {

    db.run('insert into local_relations (parent_inode_number, child_inode_number) values ($parent_inode_number, $child_inode_number)', {
      $parent_inode_number: parent,
      $child_inode_number: child
    }, function(err) {
      if (err) return reject(err);

      resolve();
    });

  });
};



var createResourceMapping = function(db, inode, resource) {
  return new RSVP.Promise(function(resolve, reject) {

    db.run('insert into mapping (inode_number, resource_id) values ($inode_number, $resource_id)', {
      $inode_number: inode,
      $resource_id: resource
    }, function(err) {
      if (err) return reject(err);

      resolve();
    });

  });
};



var createRecords = function(db, mapped) {
  return new RSVP.Promise(function(resolve, reject) {

    createLocalEntry(db, mapped).then(function() {

      createResourceMapping(db, mapped.stats.ino, mapped.resourceId).then(function() {

        RSVP.all(mapped.children.map(function(child) {

          return new RSVP.Promise(function(resolve, reject) {

            createLocalRelation(db, mapped.stats.ino, child).then(resolve, reject);

          });

        })).then(resolve, reject);

      }, reject);

    }, reject);

  });
};



var processMapped = function(db) {
  return new RSVP.Promise(function(resolve, reject) {

    return RSVP.all(Object.keys(mapOldToNew).map(function(inode) {

      return new RSVP.Promise(function(resolve, reject) {

        var mapped = mapOldToNew[inode];
        console.log(inode + ' -> ' + mapped.stats.ino + '\t' + mapped.entry.filename);
        createRecords(db, mapped).then(resolve, reject);

      });

    })).then(resolve, reject);

  });
};






prepare().then(function(options) {

  var root = '/Users/heath/Google Drive';

  return locateByFilename(options.src, root).then(function(entry) {

    return doMagic(options.src, '', entry.inode_number, null).then(function() {
      
      return processMapped(options.dst).then(function() {

        console.log('done.');

      }, console.log);
    
    }, console.log);

  }, console.log);

}, console.log);

