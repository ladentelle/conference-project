
$(document).ready(function() {
	var saveTimeOut = 5000;
	var saveInterval; 
	var editContentElement = $(".mainText");  
	var storageKey = "editContentElement"

	editContentElement.popline({position: 'relative'});

	var saveToStorage = function() {
		var	editContent = editContentElement.html();

		chrome.storage.sync.set({storageKey: editContent}, function() {
          // Notify that we saved.
          console.log('Settings saved');
        });
	} 
	var getFromStorage = function() {
		var storageContent = chrome.storage.sync.get(storageKey); 
		console.log(storageContent)
	}
	saveInterval = setInterval(saveToStorage, saveTimeOut);

	editContentElement.onfocus = getFromStorage

	function log(msg) {
    document.getElementById("log").value += msg + "\n";
}

	var p = document.getElementById("p");

	p.onfocus = function() {
    log("focus");
};

if ("addEventListener" in p) {
    p.addEventListener("DOMCharacterDataModified", function() {
        log("DOMCharacterDataModified");
    }, false);
}


});

