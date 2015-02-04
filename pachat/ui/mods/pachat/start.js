$(document).ready(function() {
	// remove cpu intensive background animations so people can idle in chat without wasting a lot of CPU time
	$('#logo_slide_top').css('left', "350px").removeAttr("id");
	$('#logo_slide_bottom').css('left', "280px").removeAttr("id");
});