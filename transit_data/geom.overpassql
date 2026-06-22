[out:json][timeout:300];
(
relation["route"="subway"](40.78,28.40,41.45,29.62);
relation["route"="light_rail"](40.78,28.40,41.45,29.62);
relation["route"="tram"](40.78,28.40,41.45,29.62);
relation["route"="funicular"](40.78,28.40,41.45,29.62);
relation["route"="monorail"](40.78,28.40,41.45,29.62);
relation["route"="train"]["name"~"Marmaray",i](40.78,28.40,41.45,29.62);
relation["route"="bus"]["ref"~"^34[A-Z]{0,2}$"](40.78,28.40,41.45,29.62);
);
out geom;
node(r);
out;
