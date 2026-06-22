[out:json][timeout:200];
(
relation["route"="ferry"](40.78,28.40,41.45,29.62);
)->.r;
.r out geom;
node(r.r);
out;
