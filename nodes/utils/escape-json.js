/*
  Escape JSON
*/
var escapeJSON = exports.escapeJSON = function(json) {
    var escapable = /[\\\"\x00-\x1f\x7f-\x9f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var meta = {    // table of character substitutions
                '\b': '\\b',
                '\t': '\\t',
                '\n': '\\n',
                '\f': '\\f',
                '\r': '\\r',
                '"' : '\\"',
                '\\': '\\\\'
              };
  
    escapable.lastIndex = 0;
    return escapable.test(json) ? '"' + json.replace(escapable, function (a) {
        var c = meta[a];
        return (typeof c === 'string') ? c
          : '\\u' + ('0000' + a.charCodeAt(0).toString(16)).slice(-4);
    }) + '"' : '"' + json + '"';
  
  };