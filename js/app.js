var _this = this;
function OSType() {
    var OSName = "Unknown OS";
    if (navigator.appVersion.indexOf("Win") !== -1) {
        OSName = "Windows";
    }
    if (navigator.appVersion.indexOf("Mac") !== -1) {
        OSName = "MacOS";
    }
    if (navigator.appVersion.indexOf("X11") !== -1) {
        OSName = "UNIX";
    }
    if (navigator.appVersion.indexOf("Linux") !== -1) {
        OSName = "Linux";
    }
    return OSName;
}
function inBeta() {
    if (chrome.runtime.getManifest().name.indexOf("Beta") !== -1) {
        return true;
    }
    return false;
}
var Loader = {
    loader: $("#loader"),
    show: function () {
        this.loader.siblings("div").hide();
        this.loader.show();
    },
    hide: function () {
        this.loader.hide();
    }
};
var ErrorHandler = {
    $el: {
        city: $("#city"),
        error: $("#error"),
        weather: $("#weather-inner")
    },
    show: function (message) {
        Loader.hide();
        ErrorHandler.$el.error.html(message);
        ErrorHandler.$el.error.show();
        ErrorHandler.$el.weather.hide();
        ErrorHandler.$el.city.hide();
    },
    hide: function () {
        ErrorHandler.$el.error.hide();
        ErrorHandler.$el.weather.show();
    },
    offline: function () {
        ErrorHandler.show($("#offlineError").html());
    },
    noAppLocation: function () {
        ErrorHandler.show($("#locationError").html());
        $("#set-location").submit(function () {
            var address = $("#error form input").val();
            if (!_.isEmpty(address)) {
                // Geocode address
                AppLocation.gecodeAddress(address).then(function (data) {
                    var options;
                    options.location = data.location;
                    options.address = data.address;
                    AppStorage.clearWeather().then(function () {
                        AppStorage.setOptions(options).then(main);
                    });
                }, function () {
                    // FIXME: Add waring about not finding address.
                });
            }
            return false;
        });
    }
};
var Notifications = {
    urls: {
        beta: "https://s3.amazonaws.com/currently-notifications/notifications.beta.json",
        gold: "https://s3.amazonaws.com/currently-notifications/notifications.json"
    },
    current: function (location) {
        // Get notification json
        return Notifications.request()
            .then(Notifications.parse)
            .then(function (data) {
            return Notifications.filter(data, location);
        });
    },
    isActive: function (message) {
        return message.active;
    },
    isInTimeFrame: function (message) {
        var now = new Date();
        if (!message.dates) {
            return true;
        }
        if (message.dates.start && !message.dates.end) {
            if (message.dates.start <= now) {
                return true;
            }
        }
        if (message.dates.start && message.dates.end) {
            return (message.dates.start <= now && message.dates.end >= now);
        }
        return true;
    },
    isInAppLocation: function (message, location) {
        if (message.geo) {
            if (message.geo.type === "distance") {
                var pass = geolib.isPointInCircle({
                    latitude: location.lat,
                    longitude: location.lng
                }, message.geo.from, (message.geo.distance * 1609.344));
                return pass;
            }
        }
        return false;
    },
    isNew: function (message) {
        return AppStorage.seenNotifications().then(function (seen) {
            return !_.contains(seen, message.id);
        });
    },
    filter: function (messages, location) {
        var checks = [];
        _.each(messages, function (message) {
            var check = Q.all([
                Notifications.isActive(message),
                Notifications.isNew(message),
                Notifications.isInTimeFrame(message),
                Notifications.isInAppLocation(message, location),
            ]).spread(function (active, isnew, time, applocation) {
                if (active && isnew && time && applocation) {
                    return message;
                }
            });
            checks.push(check);
        });
        return Q.allResolved(checks)
            .then(function (promises) {
            var results = [];
            _.each(promises, function (promise) {
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
    parse: function (messages) {
        _.each(messages, function (message) {
            if (message.dates) {
                message.dates.start = new Date(message.dates.start);
                if (message.dates.end) {
                    message.dates.end = new Date(message.dates.end);
                }
            }
        });
        return messages;
    },
    getCached: function () {
        return AppStorage.getNotifications();
    },
    cache: function (data) {
        return AppStorage.cacheNotifications(data);
    },
    url: function () {
        if (inBeta()) {
            return Notifications.urls.beta;
        }
        return Notifications.urls.gold;
    },
    request: function () {
        return Notifications.getCached().then(function (data) {
            return data;
        }, function () {
            return Q.when($.ajax({
                dataType: "json",
                url: Notifications.url()
            })).then(Notifications.cache);
        });
    },
    finish: function (id) {
        return AppStorage.markNotification(id);
    }
};
var AppStorage = {
    cache: {},
    notifications: {
        defaults: {},
        key: "notifications",
        location: "local"
    },
    weather: {
        defaults: {},
        key: "weather",
        location: "local"
    },
    options: {
        defaults: {
            clock: 12,
            unitType: "f",
            seconds: true,
            lang: "EN",
            location: {},
            animation: true,
            textColor: "light-text",
            color: "dark-bg"
        },
        key: "options",
        location: "sync"
    },
    bestAppStorageAppLocation: function (type) {
        // Check if recommended location exists if not, save to local;
        if (AppStorage[type].location === "sync") {
            if (chrome.storage.sync) {
                return chrome.storage.sync;
            }
        }
        return chrome.storage.local;
    },
    load: function (type, useCache) {
        if (_.isUndefined(useCache)) {
            useCache = true;
        }
        if (useCache && AppStorage.cache[type]) {
            return AppStorage.cache[type];
        }
        if (!useCache || !AppStorage.cache[type]) {
            var deferred_1 = Q.defer();
            this.bestStorageAppLocation(type).get(Storage[type].key, function (value) {
                if (!_.isEmpty(value)) {
                    deferred_1.resolve(value[AppStorage[type].key]);
                }
                deferred_1.reject(new Error("Missing Data"));
            });
            AppStorage.cache[type] = deferred_1.promise;
        }
        return AppStorage.cache[type];
    },
    save: function (type, data) {
        var deferred = Q.defer();
        var key = AppStorage[type].key;
        function _save(current) {
            var saveData = {};
            if (!_.isNull(current)) {
                saveData[key] = _.extend(current, data);
            }
            saveData[key] = data;
            this.bestStorageAppLocation(type).set(saveData, function (value) {
                deferred.resolve(value);
                AppStorage.cache[type] = null;
            });
        }
        AppStorage.load(type, false).then(_save, function () {
            _save(null);
        });
        return deferred.promise;
    },
    remove: function (type) {
        var deferred = Q.defer();
        var key = AppStorage[type].key;
        this.bestStorageAppLocation(type).remove(key, function (value) {
            AppStorage.cache[type] = null;
            deferred.resolve(value);
        });
        return deferred.promise;
    },
    castOptions: function (key, value) {
        // Case boolean if it is a boolean
        if (value === "true") {
            return true;
        }
        if (value === "false") {
            return false;
        }
        if (!_.isNaN(parseInt(value, 10)) && !isNaN(value)) {
            return parseInt(value, 10);
        }
        if (_.isUndefined(value)) {
            return AppStorage.options.defaults[key];
        }
        return value;
    },
    getOption: function (key) {
        return this.load("options").then(function (data) {
            return AppStorage.castOptions(key, data[key]);
        }, function () {
            return AppStorage.options.defaults[key];
        });
    },
    getOptions: function () {
        return this.load("options").then(function (data) {
            var options = _.clone(AppStorage.options.defaults);
            _.each(data, function (value, key) {
                options[key] = AppStorage.castOptions(key, value);
            });
            return options;
        }, function () {
            return AppStorage.options.defaults;
        });
    },
    setOption: function (key, value) {
        value = AppStorage.castOptions(key, value);
        var obj = {};
        obj[key] = value;
        return AppStorage.save("options", obj);
    },
    setOptions: function (data) {
        var options = _.clone(data);
        _.each(options, function (value, key) {
            options[key] = AppStorage.castOptions(key, value);
        });
        return AppStorage.save("options", options);
    },
    getCachedWeather: function () {
        return this.load("weather")
            .then(function (data) {
            var now = new Date();
            if (now.getTime() < (parseInt(data.cachedAt, 10) + 60000 * 60)) {
                return data;
            }
            throw new Error("Invalid Cache");
        });
    },
    cacheWeather: function (data) {
        var date = new Date();
        data.cachedAt = date.getTime();
        return AppStorage.save("weather", data).then(function () {
            return data;
        });
    },
    clearWeather: function () {
        return AppStorage.remove("weather");
    },
    cacheNotifications: function (data) {
        var date = new Date();
        var save = {
            cachedAt: date.getTime(),
            data: data
        };
        return AppStorage.save("notifications", save).then(function () {
            return data;
        });
    },
    getNotifications: function () {
        return this.load("notifications")
            .then(function (data) {
            var now = new Date();
            // if (now.getTime() < (parseInt(data.cachedAt) + 15000)) { // Valid for 15 seconds
            if (now.getTime() < (parseInt(data.cachedAt, 10) + 60000 * 120)) {
                return data.data;
            }
            throw new Error("Invalid Cache");
        });
    },
    markNotification: function (id) {
        return AppStorage.load("notifications", false)
            .then(function (data) {
            var seen = [];
            if (data.seen) {
                seen = data.seen;
            }
            seen.push(id);
            data.seen = seen;
            return AppStorage.save("notifications", data);
        });
    },
    seenNotifications: function () {
        return this.load("notifications").then(function (data) {
            return data.seen;
        }, function () {
            return [];
        });
    }
};
var AppLocation = {
    getDisplayName: function (location) {
        return Q.when($.ajax({
            data: { latlng: location.lat + "," + location.lng, sensor: false },
            dataType: "json",
            url: "https://maps.googleapis.com/maps/api/geocode/json"
        }))
            .then(function (data) {
            if (data.status === "OK") {
                var result = data.results[0].address_components;
                var info = [];
                for (var _i = 0, result_1 = result; _i < result_1.length; _i++) {
                    var entry = result_1[_i];
                    if (entry.types[0] === "country") {
                        info.push(entry.long_name);
                    }
                    if (entry.types[0] === "administrative_area_level_1") {
                        info.push(entry.short_name);
                    }
                    if (entry.types[0] === "locality") {
                        info.unshift(entry.long_name);
                    }
                }
                var locData = _.uniq(info);
                // if (locData.length === 3) {
                //     locData.pop(2);
                // }
                return locData.join(", ");
            }
            throw new Error("Failed to geocode");
        });
    },
    gecodeAddress: function (address) {
        return Q.when($.ajax({
            data: { address: address, sensor: false },
            dataType: "json",
            url: "https://maps.googleapis.com/maps/api/geocode/json"
        })).then(function (data) {
            if (data.status === "OK") {
                return {
                    address: data.results[0].formatted_address,
                    location: data.results[0].geometry.location
                };
            }
        });
    },
    current: function () {
        var deferred = Q.defer();
        if (navigator.geolocation) {
            // if (false) {
            navigator.geolocation.getCurrentPosition(function (position) {
                deferred.resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
                // deferred.resolve({lat: -222, lng: 2})
            }, function () {
                deferred.reject(new Error("Couldn't find location"));
            });
        }
        deferred.reject(new Error("Geolocation is missing"));
        return deferred.promise;
    }
};
var Weather = {
    $el: {
        city: $("#city"),
        forecast: $("#weather li"),
        now: $(".now")
    },
    urlBuilder: function (type, location, lang) {
        var url = "http://api.wunderground.com/api/dc203fba39f6674e/" + type + "/";
        if (lang) {
            url = url + "lang:" + lang + "/";
        }
        return url + "q/" + location.lat + "," + location.lng + ".json";
    },
    atAppLocation: function (location) {
        return AppStorage.getOption("lang").then(function (lang) {
            return Q.when($.ajax({
                dataType: "json",
                type: "GET",
                url: Weather.urlBuilder("conditions/forecast/", location, lang)
            }))
                .then(function (data) {
                return AppLocation.getDisplayName(location).then(function (name) {
                    data.locationDisplayName = name;
                    return data;
                });
            })
                .then(Weather.parse)
                .then(AppStorage.cacheWeather);
        });
    },
    parse: function (data) {
        return AppStorage.getOption("unitType").then(function (unitType) {
            var startUnitType = "f";
            // Lets only keep what we need.
            var w2 = {
                city: data.locationDisplayName,
                current: {
                    condition: data.current_observation.weather,
                    conditionCode: Weather.condition(data.current_observation.icon_url),
                    temp: Weather.tempConvert(data.current_observation.temp_f, startUnitType, unitType)
                },
                forecast: [],
                weatherUrl: data.current_observation.forecast_url
            };
            for (var i = Weather.$el.forecast.length - 1; i >= 0; i--) {
                var df = data.forecast.simpleforecast.forecastday[i];
                w2.forecast[i] = {
                    condition: df.conditions,
                    conditionCode: Weather.condition(df.icon_url),
                    day: df.date.weekday,
                    high: Weather.tempConvert(df.high.fahrenheit, startUnitType, unitType),
                    low: Weather.tempConvert(df.low.fahrenheit, startUnitType, unitType)
                };
            }
            return w2;
        });
    },
    condition: function (url) {
        var matcher = /\/(\w+).gif$/;
        var code = matcher.exec(url).toString();
        if (code) {
            code = code[1];
        }
        code = null;
        switch (code) {
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
                return "T";
        }
    },
    render: function (wd) {
        // Set Current Information
        Weather.renderDay(Weather.$el.now, wd.current);
        Weather.$el.city.html(wd.city).show();
        // Show Weather & Hide Loader
        $("#weather-inner").removeClass("hidden").show();
        // Show Forecast
        AppStorage.getOption("animation").done(function (animation) {
            Weather.$el.forecast.each(function (i, el) {
                var $el = $(el);
                if (animation) {
                    $el.css("-webkit-animation-delay", 150 * i + "ms").addClass("animated fadeInUp");
                }
                var dayWeather = wd.forecast[i];
                Weather.renderDay($el, dayWeather);
            });
        });
    },
    link: function (data) {
        return data.weatherUrl + "?apiref=846edca2fe64735c";
    },
    renderDay: function (el, data) {
        el.attr("title", data.condition);
        el.find(".weather").html(data.conditionCode);
        if (!_.isUndefined(data.high) && !_.isUndefined(data.low)) {
            el.find(".high").html(data.high);
            el.find(".low").html(data.low);
        }
        el.find(".temp").html(data.temp);
        if (data.day) {
            el.find(".day").html(data.day);
        }
    },
    tempConvert: function (temp, startType, endType) {
        temp = Math.round(parseFloat(temp));
        if (startType === "f") {
            if (endType === "c") {
                return Math.round((5 / 9) * (temp - 32));
            }
            return temp;
        }
        if (endType === "c") {
            return temp;
        }
        else {
            return Math.round((9 / 5) * temp + 32);
        }
    },
    load: function () {
        Loader.show();
        return AppStorage.getCachedWeather()
            .fail(function () {
            // No Cache
            return AppStorage.getOption("location")
                .then(function (location) {
                if (!_.isEmpty(location)) {
                    return location;
                }
                var l = AppLocation.current();
                l.fail(ErrorHandler.noAppLocation);
                return l;
            })
                .then(Weather.atAppLocation);
        });
    }
};
var Clock = {
    $el: {
        analog: {
            hour: $("#hourhand"),
            minute: $("#minutehand"),
            second: $("#secondhand")
        },
        digital: {
            date: $("#date"),
            time: $("#time")
        }
    },
    _parts: {},
    _running: {},
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    timeParts: function (options) {
        var date = new Date();
        var hour = date.getHours();
        if (options.clock === 12) {
            if (hour > 12) {
                hour = hour - 12;
            }
            if (hour === 0) {
                hour = 12;
            }
        }
        return {
            // Digital
            date: date.getDate(),
            day: Clock.weekdays[date.getDay()],
            month: Clock.months[date.getMonth()],
            hour: Clock.appendZero(hour),
            minute: Clock.appendZero(date.getMinutes()),
            second: Clock.appendZero(date.getSeconds()),
            // Analog
            secondAngle: date.getSeconds() * 6,
            minuteAngle: date.getMinutes() * 6,
            hourAngle: ((date.getHours() % 12) + date.getMinutes() / 60) * 30
        };
    },
    appendZero: function (num) {
        if (num < 10) {
            return "0" + num;
        }
        return num;
    },
    dateTemplate: function (parts) {
        return parts.day + ", " + parts.month + " " + parts.date;
    },
    transformTemplate: function (angle) {
        return "rotate(" + angle + ",50,50)";
    },
    refresh: function (options) {
        var parts = Clock.timeParts(options);
        var oldParts = Clock._parts || {};
        Clock.$el.digital.date.html(Clock.dateTemplate(parts));
        _.each(["hour", "minute", "second"], function (unit) {
            if (parts[unit] !== oldParts[unit]) {
                Clock.$el.digital.time.find("." + unit).text(parts[unit]);
                Clock.$el.analog[unit].attr("transform", Clock.transformTemplate(parts[unit + "Angle"]));
            }
        });
        Clock._parts = parts;
    },
    start: function (options) {
        if (Clock._running) {
            // clearInterval(Clock._running);
        }
        function tick() {
            var delayTime = 500;
            Clock.refresh(options);
            Clock._running = setTimeout(function () {
                window.requestAnimationFrame(tick);
            }, delayTime);
        }
        tick();
    }
};
function style() {
    AppStorage.getOptions().done(function (options) {
        // Kick off the clock
        Clock.start(options);
        var $main = $("#main");
        // background Color
        if (!$main.hasClass(options.color)) {
            if ($main.is("[class*='-bg']")) {
                $main[0].className = $main[0].className.replace(/\w*-bg/g, "");
            }
            $main.addClass(options.color);
        }
        // Text Color
        if (!$main.hasClass(options.textColor)) {
            if ($main.is("[class*='-text']")) {
                $main[0].className = $main[0].className.replace(/\w*-text/g, "");
            }
            $main.addClass(options.textColor);
        }
        // Remove animation
        if (!options.animation) {
            $(".animated").removeClass("animated");
            $(".fadeIn").removeClass("fadeIn");
            $(".fadeInDown").removeClass("fadeInDown");
        }
        if (!options.seconds) {
            $("#main").addClass("no-seconds");
        }
        // Remove weather
        if (!options.weather) {
            $("#main #weather").addClass("hidden");
        }
    });
}
function main() {
    var _this = this;
    var loader = Weather.load().then(function (data) {
        Loader.hide();
        Weather.render(data);
    });
    loader.fail(function (reason) {
        if (!navigator.onLine) {
            // We are offline
            ErrorHandler.offline();
        }
    });
    loader.then(function () {
        $(".tipsy").tipsy({ fade: true, delayIn: 500, gravity: "s" });
        $("#weather-inner li").tipsy({ fade: true, delayIn: 500, offset: 5, gravity: "s" });
        $("#weather-inner .now").tipsy({ fade: true, delayIn: 500, offset: -20, gravity: "s" });
    });
    // Notifications
    AppLocation.current().then(Notifications.current).then(function (messages) {
        if (!_.isEmpty(messages)) {
            $("#update p").html(messages[0].html).parent().data("id", messages[0].id).show(0);
        }
    });
    $("#update").click(function () {
        $(_this).fadeOut(100);
        Notifications.finish($(_this).data("id"));
    });
}
// Start your engine....
style();
main();
if (navigator.onLine) {
    var ga = document.createElement("script");
    ga.type = "text/javascript";
    ga.async = true;
    ga.src = "https://ssl.google-analytics.com/ga.js";
    var s = document.getElementsByTagName("script")[0];
    s.parentNode.insertBefore(ga, s);
}
else {
    $(window).bind("online", function () {
        setTimeout(function () {
            // wait one second before trying.
            ErrorHandler.hide();
            main();
        }, 1000);
    });
}
/* UI Handlers
################################################*/
$(".home").click(function () {
    chrome.tabs.update({ url: "chrome-internal://newtab/" });
    return false;
});
var settings = $(".settings");
setTimeout(function () {
    settings.first().fadeIn(0); // Unhide first settings panel.
}, 100);
$(".options").click(function () {
    AppStorage.getOptions().done(function (options) {
        OptionsView.set(options);
        switchPreviewBgColor($("#options #color-pick input").val());
        switchPreviewTextColor($("input[name=textColor]:checked").val());
        $("#options #list li:not(#options .active)").each(function (index) {
            $(_this).css("-webkit-animation-delay", 80 * index + "ms").addClass("animated fadeInLeft");
        });
    });
    return false;
});
function showOptions() {
    if (window.location.hash === "#options") {
        $(".options").trigger("click");
    }
}
$(window).bind("hashchange", showOptions);
showOptions();
$("#options #list li").click(function () {
    var $el = $(_this);
    // Update List
    $("#options #list li.active").removeClass("active");
    $el.addClass("active");
    // Load New Content
    $(".settings.show").fadeOut(0).removeClass("show");
    var idx = $(_this).index();
    $(settings[idx]).fadeIn(100).addClass("show");
});
function switchPreviewBgColor(bgclass) {
    var $li = $("#options #color-pick li");
    var $preview = $("#preview");
    $li.removeClass("active");
    $li.filter("." + bgclass).addClass("active");
    $preview[0].className = $preview[0].className.replace(/\w*-bg/g, "");
    $preview.addClass(bgclass);
}
function switchPreviewTextColor(textclass) {
    var $preview = $("#preview");
    $preview[0].className = $preview[0].className.replace(/\w*-text/g, "");
    $preview.addClass(textclass);
}
$("#options #color-pick li").click(function () {
    var $li = $(_this);
    var className = $li[0].className.match(/\w*-bg/g)[0];
    $("#options #color-pick input").val(className);
    switchPreviewBgColor(className);
});
$("input[name=textColor]").change(function () {
    var $input = $(this);
    switchPreviewTextColor($input.val());
});
function save(options) {
    AppStorage.clearWeather().then(function () {
        AppStorage.setOptions(options).then(function () {
            style();
            main();
        });
        // Save options
        $("#options button[type=submit]").addClass("saved");
        setTimeout(function () {
            $("#options button").removeClass("saved").html("SAVE");
        }, 500);
    });
}
$("#options form").submit(function () {
    var $form = $(_this);
    var options;
    _.each($form.serializeArray(), function (inputs) {
        options[inputs.name] = inputs.value;
    });
    if (options.address) {
        // Geocode address
        AppLocation.gecodeAddress(options.address).then(function (data) {
            options.location = data.location;
            options.address = data.address;
            save(options);
        });
    }
    else {
        options.location = undefined;
        options.address = undefined;
        save(options);
    }
    return false;
});
var OptionsView = {
    panel: {
        layout: {
            ananimation: $("input[name=animation]")
        },
        style: {
            color: $("#color-pick input[type=hidden]"),
            textColor: $("input[name=textColor]")
        },
        system: {
            address: $("input[name=address]"),
            clock: $("input[name=clock]"),
            lang: $("select[name=lang]"),
            unitType: $("input[name=unitType]")
        }
    },
    set: function (options) {
        _.each(OptionsView.panel, function (elements, panel) {
            _.each(elements, function ($el, type) {
                if ($el.is(":radio")) {
                    $el.filter("[value=" + options[type] + "]").attr("checked", "checked");
                }
                else {
                    $el.val(options[type]);
                }
            });
        });
    }
};
