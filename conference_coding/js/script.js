
$(document).ready(function() {
	var saveTimeOut = 6000;
	var saveInterval; 
	var editContentElement = $(".mainText");  

	editContentElement.popline({position: 'relative'});

	var saveToStorage = function() {
		var	editContent = editContentElement.html();

		chrome.storage.sync.set({'editContentElement': editContent}, function() {
          // Notify that we saved.
          console.log('Settings saved');
        });
	} 
	saveInterval = setInterval(saveToStorage, saveTimeOut);
});
