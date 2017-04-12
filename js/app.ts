interface Options {
    location: string;
    address: string;
}

interface Dates {
    start: Date;
    end: Date;
}

interface Message {
    dates: Dates;
}


function OSType() {
    let OSName = "Unknown OS";
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


const Loader = {
    loader: $('#loader'),
    show() {
        this.loader.siblings('div').hide();
        this.loader.show();
    },
    hide() {
        this.loader.hide();
    }
};

const ErrorHandler = {
    $el: {
        city: $("#city"),
        error: $("#error"),
        weather: $("#weather-inner"),
    },
    show(message) {
        Loader.hide();
        ErrorHandler.$el.error.html(message);
        ErrorHandler.$el.error.show();
        ErrorHandler.$el.weather.hide();
        ErrorHandler.$el.city.hide();
    },
    hide() {
        ErrorHandler.$el.error.hide();
        ErrorHandler.$el.weather.show();
    },
    offline () {
        ErrorHandler.show($("#offlineError").html());
    },
    noAppLocation () {
        ErrorHandler.show($("#locationError").html());
        $("#set-location").submit(function () {
            const address = $('#error form input').val();
            if (!_.isEmpty(address)) {
                // Geocode address
                AppLocation.gecodeAddress(address).then(function (data) {
                    let options:Options;
                    options.location = data.location;
                    options.address = data.address;
                    AppStorage.clearWeather().then(function () {
                        AppStorage.setOptions(options).then(main);
                    });
                }, function () {
                    // FIXME: Add waring about not finding address.
                });
            }
            else {
                // FIXME: Add validation to address
            }
            return false;
        });
    }
};
const Notifications = {
    urls: {
        beta: "https://s3.amazonaws.com/currently-notifications/notifications.beta.json",
        gold: "https://s3.amazonaws.com/currently-notifications/notifications.json"
    },
    current(location) {
        // Get notification json
        return Notifications.request()
            .then(Notifications.parse)
            .then(function (data) {
                return Notifications.filter(data, location);
            });
    },
    isActive(message) {
        return message.active;
    },
    isInTimeFrame(message) {
        const now = new Date();
        if (!message.dates) {
            return true;
        }
        else if (message.dates.start && !message.dates.end) {
            if (message.dates.start <= now) {
                return true;
            }
        }
        else if (message.dates.start && message.dates.end) {
            return (message.dates.start <= now && message.dates.end >= now);
        }
        else {
            return false;
        }
        return true;
    },
    isInAppLocation(message, location) {
        if (message.geo) {
            if (message.geo.type === "distance") {
                const pass = geolib.isPointInCircle(
                    { 
                        latitude: location.lat,
                        longitude: location.lng
                    },
                    message.geo.from, (message.geo.distance * 1609.344));
                return pass;
            }
        }
        else {
            return true;
        }
        return false;
    },
    isNew(message) {
        return AppStorage.seenNotifications().then(function (seen) {
            return !_.contains(seen, message.id);
        });
    },
    filter(messages:Message[], location) {
        const checks = [];
        _.each(messages, (message) => {
            const check = Q.all([
                Notifications.isActive(message),
                Notifications.isNew(message),
                Notifications.isInTimeFrame(message),
                Notifications.isInAppLocation(message, location)
            ]).spread((active, isnew, time, location) => {
                if (active && isnew && time && location) {
                    return message;
                }
            });
            checks.push(check);
        });
        return Q.allResolved(checks)
            .then((promises) => {
                const results = [];
                _.each(promises, (promise) => {
                    if (promise.isFulfilled()) {
                        const message = promise.valueOf();
                        if (!_.isUndefined(message)) {
                            results.push(message);
                        }
                    }
                });
                return results;
            });
    },
    parse(messages:Message[]) {
        _.each(messages, (message) => {
            if (message.dates) {
                message.dates.start = new Date(message.dates.start);
                if (message.dates.end) {
                    message.dates.end = new Date(message.dates.end);
                }
            }
        });
        return messages;
    },
    getCached () {
        return AppStorage.getNotifications();
    },
    cache (data) {
        return AppStorage.cacheNotifications(data);
    },
    url () {
        if (inBeta()) {
            return Notifications.urls.beta;
        }
        else {
            return Notifications.urls.gold;
        }
    },
    request () {
        return Notifications.getCached().then(function (data) {
            return data;
        }, function () {
            return Q.when($.ajax({
                url: Notifications.url(),
                dataType: "json"
            })).then(Notifications.cache);
        });
    },
    finish (id) {
        return AppStorage.markNotification(id);
    }
};


const AppStorage = {
    cache: {},
    notifications: {
        key: "notifications",
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
            location: {},
            animation: true,
            textColor: "light-text",
            color: "dark-bg"
        }
    },
    bestAppStorageAppLocation (type) {
        // Check if recommended location exists if not, save to local;
        if (AppStorage[type].location === "sync") {
            if (chrome.storage.sync) {
                return chrome.storage.sync;
            }
        }
        return chrome.storage.local;
    },
    load(type, use_cache) {
        if (_.isUndefined(use_cache)) {
            use_cache = true;
        }
        if (use_cache && AppStorage.cache[type]) {
            return AppStorage.cache[type];
        }
        else if (!use_cache || !AppStorage.cache[type]) {
            const deferred = Q.defer();
            this.bestStorageAppLocation(type).get(Storage[type].key, (value) => {
                if (!_.isEmpty(value)) {
                    deferred.resolve(value[AppStorage[type].key]);
                }
                else {
                    deferred.reject(new Error("Missing Data"));
                }
            });
            AppStorage.cache[type] = deferred.promise;
        }
        return AppStorage.cache[type];
    },
    save (type, data) {
        const deferred = Q.defer();
        const key = AppStorage[type].key;
        function _save(current) {
            const saveData = {};
            if (!_.isNull(current)) {
                saveData[key] = _.extend(current, data);
            }
            else {
                saveData[key] = data;
            }
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
    remove (type) {
        const deferred = Q.defer();
        const key = AppStorage[type].key;
        this.bestStorageAppLocation(type).remove(key, function (value) {
            AppStorage.cache[type] = null;
            deferred.resolve(value);
        });
        return deferred.promise;
    },
    castOptions (key, value) {
        // Case boolean if it is a boolean
        if (value === 'true') {
            return true;
        }
        else if (value === 'false') {
            return false;
        }
        else if (!_.isNaN(parseInt(value)) && !isNaN(value)) {
            return parseInt(value);
        }
        else if (_.isUndefined(value)) {
            return AppStorage.options.defaults[key];
        }
        else {
            return value;
        }
    },
    getOption (key) {
        return this.load("options").then(function (data) {
            return AppStorage.castOptions(key, data[key]);
        }, function () {
            return AppStorage.options.defaults[key];
        });
    },
    getOptions () {
        return this.load("options").then(function (data) {
            const options = _.clone(AppStorage.options.defaults);
            _.each(data, function (value, key) {
                options[key] = AppStorage.castOptions(key, value);
            });
            return options;
        }, function () {
            return AppStorage.options.defaults;
        });
    },
    setOption (key, value) {
        value = AppStorage.castOptions(key, value);
        const obj = {};
        obj[key] = value;
        return AppStorage.save("options", obj);
    },
    setOptions (data) {
        const options = _.clone(data);
        _.each(options, function (value, key) {
            options[key] = AppStorage.castOptions(key, value);
        });
        return AppStorage.save("options", options);
    },
    getCachedWeather () {
        return this.load("weather")
            .then(function (data) {
                const now = new Date();
                if (now.getTime() < (parseInt(data.cachedAt) + 60000 * 60)) {
                    return data;
                }
                throw new Error("Invalid Cache");
            });
    },
    cacheWeather (data) {
        const date = new Date();
        data.cachedAt = date.getTime();
        return AppStorage.save("weather", data).then(function () {
            return data;
        });
    },
    clearWeather () {
        return AppStorage.remove("weather");
    },
    cacheNotifications (data) {
        const date = new Date();
        const save = {
            cachedAt: date.getTime(),
            data: data
        };
        return AppStorage.save("notifications", save).then(function () {
            return data;
        });
    },
    getNotifications () {
        return this.load("notifications")
            .then(function (data) {
                const now = new Date();
                // if (now.getTime() < (parseInt(data.cachedAt) + 15000)) { // Valid for 15 seconds
                if (now.getTime() < (parseInt(data.cachedAt) + 60000 * 120)) {
                    return data.data;
                }
                throw new Error("Invalid Cache");
            });
    },
    markNotification (id) {
        return AppStorage.load("notifications", false)
            .then(function (data) {
                let seen = [];
                if (data.seen) {
                    seen = data.seen;
                }
                seen.push(id);
                data.seen = seen;
                return AppStorage.save("notifications", data);
            });
    },
    seenNotifications () {
        return this.load("notifications").then(function (data) {
            return data.seen;
        }, function () {
            return [];
        });
    }
};

const AppLocation = {
    getDisplayName(location) {
        return Q.when($.ajax({
            data: { "latlng": location.lat + "," + location.lng, sensor: false },
            dataType: "json",
            url: "https://maps.googleapis.com/maps/api/geocode/json",
        }))
            .then((data) => {
                if (data.status === "OK") {
                    const result = data.results[0].address_components;
                    const info = [];
                    for(let i = 0; i < result.length; ++i) {
                        if (result[i].types[0] == "country") {
                            info.push(result[i].long_name);
                        }
                        if (result[i].types[0] == "administrative_area_level_1") {
                            info.push(result[i].short_name);
                        }
                        if (result[i].types[0] == "locality") {
                            info.unshift(result[i].long_name);
                        }
                    }
                    let locData: number[] = _.uniq(info);
                    // if (locData.length === 3) {
                    //     locData.pop(2);
                    // }
                    return locData.join(", ");
                }
                else {
                    throw new Error("Failed to geocode");
                }
            });
    },
    gecodeAddress(address) {
        return Q.when($.ajax({
            url: "https://maps.googleapis.com/maps/api/geocode/json",
            data: { "address": address, sensor: false },
            dataType: "json"
        })).then(function (data) {
            if (data.status == "OK") {
                return {
                    'location': data.results[0].geometry.location,
                    'address': data.results[0].formatted_address
                };
            }
        });
    },
    current () {
        const deferred = Q.defer();
        if (navigator.geolocation) {
            // if (false) {
            navigator.geolocation.getCurrentPosition(function (position) {
                deferred.resolve({ lat: position.coords.latitude, lng: position.coords.longitude });
                // deferred.resolve({lat: -222, lng: 2})
            }, function () {
                deferred.reject(new Error("Couldn't find location"));
            });
        }
        else {
            deferred.reject(new Error("Geolocation is missing"));
        }
        return deferred.promise;
    }
};
const Weather = {
    $el: {
        now: $('.now'),
        forecast: $('#weather li'),
        city: $('#city')
    },
    urlBuilder (type, location, lang) {
        let url = "http://api.wunderground.com/api/dc203fba39f6674e/" + type + "/";
        if (lang) {
            url = url + "lang:" + lang + "/";
        }
        return url + "q/" + location.lat + "," + location.lng + ".json";
    },
    atAppLocation (location) {
        return AppStorage.getOption("lang").then(function (lang) {
            return Q.when($.ajax({
                url: Weather.urlBuilder("conditions/forecast/", location, lang),
                type: 'GET',
                dataType: "json"
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
    parse (data) {
        return AppStorage.getOption("unitType").then(function (unitType) {
            const startUnitType = "f";
            // Lets only keep what we need.
            const w2 = {
                city: data.locationDisplayName,
                weatherUrl: data.current_observation.forecast_url,
                current: {
                    condition: data.current_observation.weather,
                    conditionCode: Weather.condition(data.current_observation.icon_url),
                    temp: Weather.tempConvert(data.current_observation.temp_f, startUnitType, unitType)
                },
                forecast: []
            };
            for (let i = Weather.$el.forecast.length - 1; i >= 0; i--) {
                const df = data.forecast.simpleforecast.forecastday[i];
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
    condition (url) {
        const matcher = /\/(\w+).gif$/;
        let code: string = matcher.exec(url).toString();
        if (code) {
            code = code[1];
        }
        else {
            // We can't find the code
            code = null;
        }
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
                console.log("MISSING", code);
                return "T";
        }
    },
    render (wd) {
        // Set Current Information
        Weather.renderDay(Weather.$el.now, wd.current);
        Weather.$el.city.html(wd.city).show();
        // Show Weather & Hide Loader
        $('#weather-inner').removeClass('hidden').show();
        // Show Forecast
        AppStorage.getOption('animation').done(function (animation) {
            Weather.$el.forecast.each(function (i, el) {
                const $el = $(el);
                if (animation) {
                    $el.css("-webkit-animation-delay", 150 * i + "ms").addClass('animated fadeInUp');
                }
                const dayWeather = wd.forecast[i];
                Weather.renderDay($el, dayWeather);
            });
        });
    },
    link (data) {
        return data.weatherUrl + "?apiref=846edca2fe64735c";
    },
    renderDay (el, data) {
        el.attr("title", data.condition);
        el.find('.weather').html(data.conditionCode);
        if (!_.isUndefined(data.high) && !_.isUndefined(data.low)) {
            el.find('.high').html(data.high);
            el.find('.low').html(data.low);
        }
        else {
            el.find('.temp').html(data.temp);
        }
        if (data.day) {
            el.find('.day').html(data.day);
        }
    },
    tempConvert (temp, startType, endType) {
        temp = Math.round(parseFloat(temp));
        if (startType === "f") {
            if (endType === 'c') {
                return Math.round((5 / 9) * (temp - 32));
            }
            else {
                return temp;
            }
        }
        else {
            if (endType === 'c') {
                return temp;
            }
            else {
                return Math.round((9 / 5) * temp + 32);
            }
        }
    },
    load () {
        Loader.show();
        return AppStorage.getCachedWeather()
            .fail(function () {
                // No Cache
                return AppStorage.getOption("location")
                    .then(function (location) {
                        if (!_.isEmpty(location)) {
                            return location;
                        }
                        else {
                            const l = AppLocation.current();
                            l.fail(ErrorHandler.noAppLocation);
                            return l;
                        }
                    })
                    .then(Weather.atAppLocation);
            });
    }
};

const Clock = {
    $el: {
        digital: {
            time: $('#time'),
            date: $('#date')
        },
        analog: {
            second: $('#secondhand'),
            minute: $('#minutehand'),
            hour: $('#hourhand')
        }
    },
    _parts:{},
    _running: {},
    weekdays: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    timeParts (options) {
        const date = new Date();
        let hour = date.getHours();
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
            day: Clock.weekdays[date.getDay()],
            date: date.getDate(),
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
    appendZero (num) {
        if (num < 10) {
            return "0" + num;
        }
        return num;
    },
    dateTemplate (parts) {
        return parts.day + ", " + parts.month + " " + parts.date;
    },
    transformTemplate (angle) {
        return "rotate(" + angle + ",50,50)";
    },
    refresh (options) {
        const parts = Clock.timeParts(options);
        const oldParts = Clock._parts || {};
        Clock.$el.digital.date.html(Clock.dateTemplate(parts));
        _.each(['hour', 'minute', 'second'], function (unit) {
            if (parts[unit] !== oldParts[unit]) {
                Clock.$el.digital.time.find('.' + unit).text(parts[unit]);
                Clock.$el.analog[unit].attr("transform", Clock.transformTemplate(parts[unit + 'Angle']));
            }
        });
        Clock._parts = parts;
    },
    start (options) {
        if (Clock._running) {
            // clearInterval(Clock._running);
        }
        function tick() {
            const delayTime = 500;
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
        const $main = $('#main');
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
        // Remove weather
        if (!options.weather) {
            $('#main #weather').addClass('hidden');
        }
    });
}
function main() {
    const loader = Weather.load().then(function (data) {
        Loader.hide();
        Weather.render(data);
    });
    loader.fail(function (reason) {
        if (!navigator.onLine) {
            // We are offline
            ErrorHandler.offline();
        }
        else {
            // Unknown error
            console.error(reason);
        }
    });
    loader.then(function () {
        $('.tipsy').tipsy({ fade: true, delayIn: 500, gravity: 's' });
        $('#weather-inner li').tipsy({ fade: true, delayIn: 500, offset: 5, gravity: 's' });
        $('#weather-inner .now').tipsy({ fade: true, delayIn: 500, offset: -20, gravity: 's' });
    });
    // Notifications
    AppLocation.current().then(Notifications.current).then(function (messages) {
        if (!_.isEmpty(messages)) {
            $("#update p").html(messages[0].html).parent().data('id', messages[0].id).show(0);
        }
    });
    $('#update').click(function () {
        $(this).fadeOut(100);
        Notifications.finish($(this).data('id'));
    });
}
// Start your engine....
style();
main();
if (navigator.onLine) {
    const ga = document.createElement('script');
    ga.type = 'text/javascript';
    ga.async = true;
    ga.src = 'https://ssl.google-analytics.com/ga.js';
    const s = document.getElementsByTagName('script')[0];
    s.parentNode.insertBefore(ga, s);
}
else {
    $(window).bind('online', function () {
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
const settings = $('.settings');

setTimeout(function () {
    settings.first().fadeIn(0); // Unhide first settings panel.
}, 100);
$(".options").click(function () {
    AppStorage.getOptions().done(function (options) {
        OptionsView.set(options);
        switchPreviewBgColor($("#options #color-pick input").val());
        switchPreviewTextColor($("input[name=textColor]:checked").val());
        $('#options #list li:not(#options .active)').each(function (index) {
            $(this).css("-webkit-animation-delay", 80 * index + "ms").addClass('animated fadeInLeft');
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
$('#options #list li').click(function () {
    const $el = $(this);
    // Update List
    $('#options #list li.active').removeClass('active');
    $el.addClass('active');
    // Load New Content
    $('.settings.show').fadeOut(0).removeClass('show');
    const idx = $(this).index();
    $(settings[idx]).fadeIn(100).addClass('show');
});
function switchPreviewBgColor(bgclass) {
    const $li = $("#options #color-pick li");
    const $preview = $("#preview");
    $li.removeClass("active");
    $li.filter("." + bgclass).addClass("active");
    $preview[0].className = $preview[0].className.replace(/\w*-bg/g, '');
    $preview.addClass(bgclass);
}
function switchPreviewTextColor(textclass) {
    const $preview = $("#preview");
    $preview[0].className = $preview[0].className.replace(/\w*-text/g, '');
    $preview.addClass(textclass);
}
$("#options #color-pick li").click(function () {
    const $li = $(this);
    const className = $li[0].className.match(/\w*-bg/g)[0];
    $("#options #color-pick input").val(className);
    switchPreviewBgColor(className);
});
$("input[name=textColor]").change(function () {
    const $input = $(this);
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
            $('#options button').removeClass('saved').html('SAVE');
        }, 500);
    });
}
$("#options form").submit(function () {
    const $form = $(this);
    let options:Options;
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
const OptionsView = {
    panel: {
        system: {
            unitType: $("input[name=unitType]"),
            clock: $("input[name=clock]"),
            lang: $("select[name=lang]"),
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
    set (options) {
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
//# sourceMappingURL=app.js.map
