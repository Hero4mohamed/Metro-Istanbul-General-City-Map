[out:json][timeout:200];
(
relation["construction:route"~"subway|light_rail|tram|monorail"](40.78,28.00,41.65,29.95);
relation["proposed:route"~"subway|light_rail|tram|monorail"](40.78,28.00,41.65,29.95);
relation["route"="construction"](40.78,28.00,41.65,29.95);
relation["route"~"subway|tram|light_rail"]["name"~"yapım|inşaat|proje|construction|Kabataş",i](40.78,28.00,41.65,29.95);
);
out tags;
