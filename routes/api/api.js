module.exports = {

    // change empty strings within json data.items to null as db doesn't allow it
    clearEmptyItemStrings: function(json, size) {
        for (var i = 0; i < size; i++) {
            for (var key in json[i]) {
                var attrName = key.toString();
                var value = json[i][attrName];
                if (value == "") {
                    json[i][attrName] = null
                }
            }
        }
        return json;
    },

    // clear any empty strings within json data to null as db doesn't allow it
    clearEmptyDataStrings: function(json) {
        for (var key in json) {
            var attrName = key.toString();
            var value = json[attrName];
            if (value == "") {
                json[attrName] = null
            }
        }

        return json;
    },


};


