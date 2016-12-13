module.exports = {

// change empty strings to null as db doesn't allow it
    clearEmptyStrings: function(json) {
        for (var i = 0; i < json.data.size; i++) {
            for (var key in json.data.items[i]) {
                var attrName = key.toString();
                var value = json.data.items[i][attrName];
                if (value == "") {
                    json.data.items[i][attrName] = null
                }
            }
        }
        return json;
    }
};


