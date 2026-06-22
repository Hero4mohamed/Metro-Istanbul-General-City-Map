[out:json][timeout:220];
(
relation["construction:route"](40.78,28.00,41.65,29.95);
relation["proposed:route"](40.78,28.00,41.65,29.95);
relation["route"="construction"](40.78,28.00,41.65,29.95);
relation["route"="proposed"](40.78,28.00,41.65,29.95);
relation["route"~"subway|tram|light_rail|monorail"]["state"~"construction|proposed",i](40.78,28.00,41.65,29.95);
);
out tags;
