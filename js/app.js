// Setup google analytics
var _gaq = _gaq || [];
_gaq.push(['_setAccount', 'UA-33402958-1']);
_gaq.push(['_trackPageview']);

Raven.config('https://b37dffa6de1b4e908c01f26629f20e65@app.getsentry.com/4859');
window.onerror = Raven.process;

function OSType() {
  var OSName="Unknown OS";
  if (navigator.appVersion.indexOf("Win")!=-1) OSName="Windows";
  if (navigator.appVersion.indexOf("Mac")!=-1) OSName="MacOS";
  if (navigator.appVersion.indexOf("X11")!=-1) OSName="UNIX";
  if (navigator.appVersion.indexOf("Linux")!=-1) OSName="Linux";
  return OSName;
}

function inBeta() {
  if (chrome.runtime.getManifest().name.indexOf("Beta") !== -1) {
    return true;
  } else {
    return false;
  }
}

var Loader = {
  loader: $('#loader'),
  show: function() {
    this.loader.siblings('div').hide();
    this.loader.show();
  },
  hide: function() {
    this.loader.hide();
  }
};

var ErrorHandler = {
  $el: {
    error: $("#error"),
    weather: $("#weather-inner"),
    city: $("#city")
  },

  show: function(message) {
    Loader.hide();
    ErrorHandler.$el.error.html(message);
    ErrorHandler.$el.error.show();
    ErrorHandler.$el.weather.hide();
    ErrorHandler.$el.city.hide();
  },

  hide: function() {
    ErrorHandler.$el.error.hide();
    ErrorHandler.$el.weather.show(); 
  },

  offline: function() {
    ErrorHandler.show($("#offlineError").html());
  },

  noLocation: function () {
    _gaq.push(['_trackEvent', 'nolocation', "missing geolocation"]);
    ErrorHandler.show($("#locationError").html());

    $("#set-location").submit(function() {
      var address = $('#error form input').val();

      if (!_.isEmpty(address)) {
        // Geocode address
        Location.gecodeAddress(address).then(function(data) {
          var options = {};
          options.location = data.location;
          options.address = data.address;
          Storage.clearWeather().then(function() {
            Storage.setOptions(options).then(main);
          });
        }, function() {
          // FIXME: Add waring about not finding address.
        });
      } else {
        // FIXME: Add validation to address
      }
      return false;
    });
  }
};

var Notifications = {

  urls: {
    gold: "https://s3.amazonaws.com/currently-notifications/notifications.json",
    beta: "https://s3.amazonaws.com/currently-notifications/notifications.beta.json"
  },

  current: function(location) {
    // Get notification json
    return Notifications.request()
      .then(Notifications.parse)
      .then(function(data) {
        return Notifications.filter(data, location);
      });
  },

  isActive: function(message) {
    return message.active;
  },

  isInTimeFrame: function(message) {
    var now = new Date();
    if (!message.dates) {
      return true;
    } else if (message.dates.start && !message.dates.end) {
      if (message.dates.start <= now) {
        return true;
      }
    } else if (message.dates.start && message.dates.end) {
      return (message.dates.start <= now && message.dates.end >= now);
    } else {
      return false;
    }
    return true;
  },

  isInLocation: function(message, location) {
    if (message.geo) {
      if (message.geo.type === "distance") {

        var pass = geolib.isPointInCircle(
          {latitude: location.lat, longitude: location.lng},
          message.geo.from,
          (message.geo.distance * 1609.344)
        );

        return pass;
      }
    } else {
      return true;
    }

    return false;
  },

  isNew: function(message) {
    return Storage.seenNotifications().then(function(seen) {
      return !_.contains(seen, message.id);
    });
  },

  filter: function(messages, location) {
    var checks = [];
    _.each(messages, function(message) {
      var check = Q.all([
        Notifications.isActive(message),
        Notifications.isNew(message),
        Notifications.isInTimeFrame(message),
        Notifications.isInLocation(message, location)
      ]).spread(function(active, isnew, time, location) {
        if (active && isnew && time && location) {
          return message;
        }
      });

      checks.push(check);
    });

    return Q.allResolved(checks)
      .then(function(promises) {
        var results = [];
        _.each(promises, function(promise) {
          if (promise.isFulfilled()) {
            var message = promise.valueOf();
            if (!_.isUndefined(message)) {
              results.push(message);
            }          
          }
        });
        return results;
      });
  },

  parse: function(messages) {
    _.each(messages, function(message) {
      if (message.dates) {
        message.dates.start= new Date(message.dates.start);

        if (message.dates.end) {
          message.dates.end = new Date(message.dates.end);
        }        
      }
    });
    return messages;
  },

  getCached: function() {
    return Storage.getNotifications();
  },

  cache: function(data) {
    return Storage.cacheNotifications(data);
  },

  url: function() {
    if (inBeta()) {
      return Notifications.urls.beta;
    } else {
      return Notifications.urls.gold;
    }
  },

  request: function() {
    return Notifications.getCached().then(function(data) {
      return data;
    }, function() {
      return Q.when($.ajax({
        url: Notifications.url(),
        dataType: "json"
      })).then(Notifications.cache);
    });
  },

  finish: function(id) {
    return Storage.markNotification(id);
  }
};

var Storage = {
  cache: {},
  notifications: {
    key : "notifications",
    location: "local",
    defaults: {}
  },

  weather: {
    key: "weather",
    location: "local",
    defaults: {}
  },

  options: {
    key: "options",
    location: "sync",
    defaults: {
      unitType: "f",
      clock: 12,
      seconds: true,
      lang: "EN",
      location: {}, // Used to store you own location.
      animation: true,
      textColor: "light-text",
      color: "dark-bg"
    }
  },

  bestStorageLocation: function(type) {
    // Check if recommended location exists if not, save to local;
    if (Storage[type].location === "sync") {
      if (chrome.storage.sync) {
        return chrome.storage.sync;
      }
    }
    return chrome.storage.local;
  },

  load: function(type, use_cache) {
    if (_.isUndefined(use_cache)) use_cache = true;

    if (use_cache && Storage.cache[type]) {
      return Storage.cache[type];
    } else if (!use_cache || !Storage.cache[type]) {
      var deferred = Q.defer();
      Storage.bestStorageLocation(type).get(Storage[type].key, function(value) {
        if (!_.isEmpty(value)) {
          deferred.resolve(value[Storage[type].key]);
        } else{
          deferred.reject(new Error("Missing Data"));
        }
      });
      Storage.cache[type] = deferred.promise;
    }
    return Storage.cache[type];
  },

  save: function(type, data) {
    var deferred = Q.defer();
    var key = Storage[type].key;
    function _save(current) {
      var saveData = {};
      if (!_.isNull(current)) {
        saveData[key] = _.extend(current, data);
      } else {
        saveData[key] = data;
      }

      Storage.bestStorageLocation(type).set(saveData, function(value) {
        deferred.resolve(value);
        Storage.cache[type] = null;
      });
    }
    Storage.load(type, false).then(_save, function(){
      _save(null);
    });
    return deferred.promise;
  },

  remove: function(type) {
    var deferred = Q.defer();
    var key = Storage[type].key;
    Storage.bestStorageLocation(type).remove(key, function(value){
      Storage.cache[type] = null;
      deferred.resolve(value);
    });
    return deferred.promise;
  },

  castOptions: function(key, value) {
    // Case boolean if it is a boolean
    if (value === 'true') {
      return true;
    } else if (value === 'false') {
      return false;
    } else if (!_.isNaN(parseInt(value)) && !isNaN(value)) {
      return parseInt(value);
    } else if (_.isUndefined(value)) {
      return Storage.options.defaults[key];
    } else {
      return value;
    }
  },

  getOption: function(key) {
    return Storage.load("options").then(function(data) {
      return Storage.castOptions(key, data[key]);
    }, function() {
      return Storage.options.defaults[key];
    });
  },

  getOptions: function() {
    return Storage.load("options").then(function(data) {

      var options = _.clone(Storage.options.defaults);
      _.each(data, function(value, key) {
        options[key] = Storage.castOptions(key, value);
      });

      return options;
    }, function() {
      return Storage.options.defaults;
    });
  },

  setOption: function(key, value) {
    value = Storage.castOptions(key, value);
    var obj = {};
    obj[key] = value;
    return Storage.save("options", obj);
  },

  setOptions: function(data) {
    var options = _.clone(data);
    _.each(options, function(value, key) {
      options[key] = Storage.castOptions(key, value);
    });

    return Storage.save("options", options);
  },

  getCachedWeather: function() {
    return Storage.load("weather")
      .then(function(data){
        var now = new Date();
        if (now.getTime() < (parseInt(data.cachedAt) + 60000 * 60)) { // Valid for one hour
          return data;
        }

        throw new Error("Invalid Cache");
      });
  },

  cacheWeather: function(data) {
    var date = new Date();
    data.cachedAt = date.getTime();
    return Storage.save("weather", data).then(function() {
      return data;
    });
  },

  clearWeather: function() {
    return Storage.remove("weather");
  },

  cacheNotifications: function(data) {
    var date = new Date();
    var save = {
      cachedAt : date.getTime(),
      data: data
    };
    return Storage.save("notifications", save).then(function() {
      return data;
    });
  },

  getNotifications: function() {
    return Storage.load("notifications")
      .then(function(data){
        var now = new Date();
        // if (now.getTime() < (parseInt(data.cachedAt) + 15000)) { // Valid for 15 seconds
        if (now.getTime() < (parseInt(data.cachedAt) + 60000 * 120)) { // Valid for 2 hour
          return data.data;
        }

        throw new Error("Invalid Cache");
      });
  },

  markNotification: function(id) {
    return Storage.load("notifications", false)
      .then(function(data) {
        var seen = [];
        if (data.seen) {
          seen = data.seen;
        }
        seen.push(id);
        data.seen = seen;
        _gaq.push(['_trackEvent', 'notifications', "seen", id.toString(), 1]);
        return Storage.save("notifications", data);
      });
  },

  seenNotifications: function() {
    return Storage.load("notifications").then(function(data) {
      return data.seen;
    }, function() {
      return [];
    });
  }
};

var Location = {
  getDisplayName: function(location) {
    return Q.when($.ajax({
      url : "https://maps.googleapis.com/maps/api/geocode/json",
      data: {"latlng": location.lat +","+ location.lng, sensor:false},
      dataType: "json"
    }))
    .then(function(data) {
      if (data.status === "OK") {
        var result=data.results[0].address_components;
        var info=[];
        for(var i=0;i<result.length;++i) {
            if(result[i].types[0]=="country"){
              info.push(result[i].long_name);
            }
            
            if(result[i].types[0]=="administrative_area_level_1"){
              info.push(result[i].short_name);
            }

            if(result[i].types[0]=="locality"){
              info.unshift(result[i].long_name);
            }

        }
        var locData = _.uniq(info);
        if (locData.length === 3) {
          locData.pop(2);
        }
        return locData.join(", ");
      } else {
        throw new Error("Failed to geocode");
      }
    });
  },

  gecodeAddress: function(address) {
    return Q.when(
      $.ajax({
        url : "https://maps.googleapis.com/maps/api/geocode/json",
        data: {"address": address, sensor: false},
        dataType: "json"
      })
    ).then(function(data) {
      if (data.status == "OK") {
        return {
          'location' : data.results[0].geometry.location,
          'address' : data.results[0].formatted_address
        };
      }
    });
  },

  current: function() {
    var deferred = Q.defer();
    if (navigator.geolocation) {
    // if (false) {
      navigator.geolocation.getCurrentPosition(
        function(position) {
          deferred.resolve({lat: position.coords.latitude, lng: position.coords.longitude});
          // deferred.resolve({lat: -222, lng: 2})
        }, function() {
          deferred.reject(new Error("Couldn't find location"));
        }
      );
    } else {
      deferred.reject(new Error("Geolocation is missing"));
    }
    return deferred.promise;
  }

};

var Weather = {

  $el: {
    now : $('.now'),
    forecast : $('#weather li'),
    city : $('#city')
  },

  urlBuilder: function(type, location, lang) {
    var url = "http://api.wunderground.com/api/dc203fba39f6674e/" + type + "/";

    if (lang) {
      url = url + "lang:" + lang + "/";
    }

    return url + "q/" + location.lat + "," + location.lng + ".json";
  },

  atLocation: function (location) {
    return Storage.getOption("lang").then(function(lang) {
      return Q.when($.ajax({
        url: Weather.urlBuilder("conditions/forecast/", location, lang),
        type: 'GET',
        dataType: "json"
      }))
      .then(function(data) {
        return Location.getDisplayName(location).then(function(name) {
          data.locationDisplayName = name;
          return data;
        });
      })
      .then(Weather.parse)
      .then(Storage.cacheWeather);
    });
  },

  parse: function(data) {
    return Storage.getOption("unitType").then(function(unitType) {
      var startUnitType = "f";

      // Lets only keep what we need.
      var w2 = {
        city: data.locationDisplayName,
        weatherUrl: data.current_observation.forecast_url,
        current: {
          condition: data.current_observation.weather,
          conditionCode: Weather.condition(data.current_observation.icon_url),
          temp: Weather.tempConvert(data.current_observation.temp_f, startUnitType, unitType)
        },
        forecast: []
      };

      for (var i = Weather.$el.forecast.length - 1; i >= 0; i--) {
        var df = data.forecast.simpleforecast.forecastday[i];
        w2.forecast[i] = {
          day: df.date.weekday,
          condition: df.conditions,
          conditionCode: Weather.condition(df.icon_url),
          high: Weather.tempConvert(df.high.fahrenheit, startUnitType, unitType),
          low: Weather.tempConvert(df.low.fahrenheit, startUnitType, unitType)
        };
      }
      return w2;
    });
  },

  condition: function (url){
    var matcher = /\/(\w+).gif$/;
    var code = matcher.exec(url);
    if (code) {
      code = code[1];
    } else {
      // We can't find the code
      code = null;
    }
    switch(code) {

      case "chanceflurries":
      case "chancesnow":
        return "p";

      case "/ig/images/weather/flurries.gif":
        return "]";

      case "chancesleet":
        return "4";

      case "chancerain":
        return "7";

      case "chancetstorms":
        return "x";

      case "tstorms":
      case "nt_tstorms":
        return "z";

      case "clear":
      case "sunny":
        return "v";

      case "cloudy":
        return "`";

      case "flurries":
      case "nt_flurries":
        return "]";

      case "fog":
      case "hazy":
      case "nt_fog":
      case "nt_hazy":
        return "g";

      case "mostlycloudy":
      case "partlysunny":
      case "partlycloudy":
      case "mostlysunny":
        return "1";

      case "sleet":
      case "nt_sleet":
        return "3";

      case "rain":
      case "nt_rain":
        return "6";

      case "snow":
      case "nt_snow":
        return "o";

      // Night Specific

      case "nt_chanceflurries":
        return "a";

      case "nt_chancerain":
        return "8";

      case "nt_chancesleet":
        return "5";

      case "nt_chancesnow":
        return "[";

      case "nt_chancetstorms":
        return "c";

      case "nt_clear":
      case "nt_sunny":
        return "/";

      case "nt_cloudy":
        return "2";

      case "nt_mostlycloudy":
      case "nt_partlysunny":
      case "nt_partlycloudy":
      case "nt_mostlysunny":
        return "2";


      default:
        console.log("MISSING", code);
        _gaq.push(['_trackEvent', 'unknowweather', code]);
        return "T";
    }
  },

  render: function(wd) {
    // Set Current Information
    Weather.renderDay(Weather.$el.now, wd.current);
    Weather.$el.city.html(wd.city).show();

    // Show Weather & Hide Loader
    $('#weather-inner').removeClass('hidden').show();

    // Show Forecast
    Storage.getOption('animation').done(function(animation) {
      Weather.$el.forecast.each(function(i, el) {
        var $el = $(el);
          if (animation) {
            $el.css("-webkit-animation-delay",150 * i +"ms").addClass('animated fadeInUp');
          }
        var dayWeather = wd.forecast[i];
        Weather.renderDay($el, dayWeather);
      });
    });

    // Change link to weather underground
    $('a.wunder').attr('href', Weather.link(wd)).click(function() {
      _gaq.push(['_trackEvent', 'button', 'click', 'weather-underground']);
    });
  },

  link: function(data) {
    return data.weatherUrl + "?apiref=846edca2fe64735c";
  },

  renderDay: function(el, data) {
    el.attr("title", data.condition);
    el.find('.weather').html(data.conditionCode);
    if (!_.isUndefined(data.high) && !_.isUndefined(data.low)) {
      el.find('.high').html(data.high);
      el.find('.low').html(data.low);
    } else {
      el.find('.temp').html(data.temp);
    }
    if(data.day) {
      el.find('.day').html(data.day);
    }
  },

  tempConvert: function(temp, startType, endType) {
    temp = Math.round(parseFloat(temp));
    if (startType === "f") {
      if (endType === 'c') {
        return Math.round((5/9)*(temp-32));
      } else {
        return temp;
      }
    } else {
      if (endType === 'c') {
        return temp;
      } else {
        return Math.round((9/5) * temp + 32);
      }
    }
  },

  load: function() {
    Loader.show();
    return Storage.getCachedWeather()
      .fail(function() {
        // No Cache
        return Storage.getOption("location")
          .then(function(location) {
            if (!_.isEmpty(location)) {
              return location;
            } else {
              var l = Location.current();
              l.fail(ErrorHandler.noLocation);

              return l;
            }
          })
          .then(Weather.atLocation);
      }); 
  }
};

var Clock = {
  $el : {
    digital : {
      time : $('#time'),
      date : $('#date')
    },
    analog: {
      second : $('#secondhand'),
      minute : $('#minutehand'),
      hour : $('#hourhand')
    }
  },

  weekdays : ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"],
  months : ["January","February","March","April","May","June","July","August","September","October","November","December"],

  timeParts: function(options) {
    var date = new Date(),
        hour = date.getHours();

    if (options.clock === 12) {
      if(hour > 12) {
          hour = hour - 12;
      } else if(hour === 0) {
        hour = 12;
      }
    }
    return {
      // Digital
      day: Clock.weekdays[date.getDay()],
      date: date.getDate(),
      month: Clock.months[date.getMonth()],
      hour: Clock.appendZero(hour),
      minute: Clock.appendZero(date.getMinutes()),
      second: Clock.appendZero(date.getSeconds()),

      // Analog
      secondAngle: date.getSeconds() * 6,
      minuteAngle: date.getMinutes() * 6,
      hourAngle: ((date.getHours() % 12) + date.getMinutes()/60) * 30
    };
  },

  appendZero : function(num) {
    if(num < 10) {
      return "0" + num;
    }
    return num;
  },

  dateTemplate: function(parts){
    return parts.day + ", " + parts.month + " " + parts.date;
  },

  transformTemplate: function(angle){
    return "rotate(" + angle + ",50,50)";
  },

  refresh: function(options) {
    var parts = Clock.timeParts(options);
    var oldParts = Clock._parts || {};

    Clock.$el.digital.date.html(Clock.dateTemplate(parts));

    _.each(['hour', 'minute', 'second'], function(unit){
      if( parts[unit] !== oldParts[unit] ){
        Clock.$el.digital.time.find('.' + unit).text(parts[unit]);
        Clock.$el.analog[unit].attr("transform", Clock.transformTemplate(parts[unit + 'Angle']));
      }
    });

    Clock._parts = parts;
  },

  start: function(options) {
    if (Clock._running) {
      clearInterval(Clock._running);
    }

    function tick() {
      var delayTime = 500;

      Clock.refresh(options);

      Clock._running = setTimeout(function(){
        window.requestAnimationFrame( tick );
      }, delayTime);
    }

    tick();
  }
};

function style() {
    Storage.getOptions().done(function(options) {
    // Kick off the clock
    Clock.start(options);
    var $main = $('#main');

    // background Color
    if (!$main.hasClass(options.color)) {
      if ($main.is("[class*='-bg']")) {
        $main[0].className = $main[0].className.replace(/\w*-bg/g, '');
      }
      $main.addClass(options.color);
    }

    // Text Color
    if (!$main.hasClass(options.textColor)) {
      if ($main.is("[class*='-text']")) {
        $main[0].className = $main[0].className.replace(/\w*-text/g, '');
      }
      $main.addClass(options.textColor);
    }

    // Remove animation
    if (!options.animation) {
      $(".animated").removeClass('animated');
      $(".fadeIn").removeClass('fadeIn');
      $(".fadeInDown").removeClass('fadeInDown');
    }

    if (!options.seconds) {
      $('#main').addClass('no-seconds');
    }

  });
}

function main() {
  var loader = Weather.load().then(function(data) {
    Loader.hide(0);
    Weather.render(data);
  });

  loader.fail(function(reason) {
    if (!navigator.onLine) {
      // We are offline
      ErrorHandler.offline();
    } else {
      // Unknown error
      console.error(reason);
      _gaq.push(['_trackEvent', 'error', reason.message]);
    }
  });

  loader.then(function() {
    $('.tipsy').tipsy({fade: true, delayIn:500, gravity: 's'});
    $('#weather-inner li').tipsy({fade: true, delayIn:500, offset:5, gravity: 's'});
    $('#weather-inner .now').tipsy({fade: true, delayIn:500, offset:-20, gravity: 's'});  
  });

  // Notifications
  Location.current().then(Notifications.current).then(function(messages) {
    if (!_.isEmpty(messages)) {
      _gaq.push(['_trackEvent', 'notifications', "show", messages[0].id.toString(), 1]);
      $("#update p").html(messages[0].html).parent().data('id', messages[0].id).show(0);
    }
  });

  $('#update').click(function(){
    $(this).fadeOut(100);
    Notifications.finish($(this).data('id'));
  });
}

// Start your engine....
style();
main();

if (navigator.onLine) {
  var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
  ga.src = 'https://ssl.google-analytics.com/ga.js';
  var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
} else {
  $(window).bind('online', function() {
    setTimeout(function() {
      // wait one second before trying.
      ErrorHandler.hide();
      main();
    }, 1000);
  });
}

/* UI Handlers
################################################*/

$(".home").click(function() {
  _gaq.push(['_trackEvent', 'button', 'click', 'default-home']);
  chrome.tabs.update({url:"chrome-internal://newtab/"});
  return false;
});

var settings = $('.settings');

// Analytics
_gaq.push(['_trackEvent', 'currently', 'version', chrome.runtime.getManifest().version]);

$('#gift').click(function() {
  _gaq.push(['_trackEvent', 'button', 'click', 'donation']);
});

$('#share').click(function() {
  _gaq.push(['_trackEvent', 'button', 'click', 'share']);
});

$('.vitaly').click(function() {
  _gaq.push(['_trackEvent', 'button', 'click', 'twitter-vitaly']);
});

$('.henry').click(function() {
  _gaq.push(['_trackEvent', 'button', 'click', 'twitter-henry']);
});

$('#support').click(function() {
  _gaq.push(['_trackEvent', 'button', 'click', 'twitter-henry']);
});

setTimeout(function() {
  settings.first().fadeIn(0); // Unhide first settings panel.
}, 100);

$(".options").click(function() {
  _gaq.push(['_trackEvent', 'button', 'click', 'options']);
  Storage.getOptions().done(function(options) {

    OptionsView.set(options);

    switchPreviewBgColor($("#options #color-pick input").val());
    switchPreviewTextColor($("input[name=textColor]:checked").val());
    
    Avgrund.show( "#options" );
    $('#options #list li:not(#options .active)').each(function(index){
      $(this).css("-webkit-animation-delay",80 * index +"ms").addClass('animated fadeInLeft');
    });
  });
  
  return false;
});

function showOptions() {
  if (window.location.hash === "#options") {
    $(".options").trigger('click');
  }
}

$(window).bind('hashchange', showOptions);
showOptions();

$('#options #list li').click(function(){
  var $el = $(this);

  // Update List
  $('#options #list li.active').removeClass('active');
  $el.addClass('active');

  _gaq.push(['_trackEvent', 'tab', 'change', $el.text()]);

  // Load New Content
  $('.settings.show').fadeOut(0).removeClass('show');
  var idx = $(this).index();
  $(settings[idx]).fadeIn(100).addClass('show');
});

function switchPreviewBgColor(bgclass) {
  var $li = $("#options #color-pick li");
  var $preview = $("#preview");
  
  $li.removeClass("active");
  $li.filter("." + bgclass).addClass("active");

  $preview[0].className = $preview[0].className.replace(/\w*-bg/g, '');
  $preview.addClass(bgclass);
}

function switchPreviewTextColor(textclass) {
  var $preview = $("#preview");
  
  $preview[0].className = $preview[0].className.replace(/\w*-text/g, '');
  $preview.addClass(textclass);
}

$("#options #color-pick li").click(function(){
  var $li = $(this);

  var className = $li[0].className.match(/\w*-bg/g)[0];
  $("#options #color-pick input").val(className);
  switchPreviewBgColor(className);

});

$("input[name=textColor]").change(function() {
  var $input = $(this);
  switchPreviewTextColor($input.val());
});

$("#options #close").click(function() {
  Avgrund.hide( "#options" );
});

function save(options) {
  Storage.clearWeather().then(function() {
    Storage.setOptions(options).then(function() {
      style();
      main();
    });
    
    // Save options
    $("#options button[type=submit]").addClass("saved");

    setTimeout(function(){
      $('#options button').removeClass('saved').html('SAVE');
    },500);
  });
}

$("#options form").submit(function() {
  var $form = $(this);
  var options = {};
  _.each($form.serializeArray(), function(inputs) {
    options[inputs.name] = inputs.value;
  });

  if (options.address) {
    // Geocode address
    Location.gecodeAddress(options.address).then(function(data) {
      options.location = data.location;
      options.address = data.address;
      save(options);
    });
  } else {
    options.location = undefined;
      options.address = undefined;
    save(options);
  }
  return false;
});

var OptionsView = {
  panel: {
    system: {
      unitType: $("input[name=unitType]"),
      clock: $("input[name=clock]"),
      lang : $("select[name=lang]"),
      address: $("input[name=address]")
    },
    layout: {
      ananimation: $("input[name=animation]")
    },
    style: {
      textColor: $("input[name=textColor]"),
      color: $("#color-pick input[type=hidden]")
    }
  },

  set: function(options) {
    _.each(OptionsView.panel, function(elements, panel) {
      _.each(elements, function($el, type) {
        if ($el.is(":radio")){
          $el.filter("[value=" + options[type] + "]").attr("checked", true);
        } else {
          $el.val(options[type]);
        }
      });
    });
  }
};
