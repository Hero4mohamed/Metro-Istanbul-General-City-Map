# Firebase (V4.6.3: accounts, friends, location sharing)

`firestore.rules` decides who may read and write each piece of data. Google's servers apply it to every request, from the app or from anything else, so it is the real protection. In short:

- Only signed-in people with a confirmed email can do anything.
- Your location can be read by you and by accepted friends only. Friends see it only while your chosen time runs (at most 8 hours) and only if your app sent it in the last 3 minutes.
- A friendship is made only by the person accepting a link, in the same write that uses up the link. A link lasts at most 48 hours and works once. Either friend can remove the friendship, and nobody can edit it.
- A profile holds only a display name (1–30 characters). Emails are never stored in the database.
- Anything not listed is denied.

**To install:** Firebase console › Firestore Database › Rules › replace everything with the contents of `firestore.rules` › Publish. Whenever this file changes, publish it again.

`rules-check.cjs` (added after setup) tries every allowed and forbidden case against the real project with two test accounts.

There is no secret key here or anywhere in the app. The web config (`transit_data/firebase-config.json`) is public by Google's design.
