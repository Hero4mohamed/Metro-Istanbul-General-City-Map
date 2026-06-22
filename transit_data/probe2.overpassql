[out:json][timeout:120];
(
relation["ref"~"^(M12|T6|T7|M11)$"](40.78,28.40,41.45,29.62);
relation["construction:route"~"subway|tram|light_rail"](40.78,28.40,41.45,29.62);
relation["proposed:route"~"subway|tram|light_rail"](40.78,28.40,41.45,29.62);
relation["route"~"subway|tram|light_rail"]["name"~"Halkalı|Kazlıçeşme|Göztepe.*Ümraniye|İFM|Finans",i](40.78,28.40,41.45,29.62);
);
out tags;
