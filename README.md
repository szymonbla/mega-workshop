# Study

Platforma do nauki: czytnik, odtwarzacz z synchronizacją tekstu, notatki, postęp i integracja z ćwiczeniami. Repozytorium zawiera kod aplikacji i sztuczne dane testowe. Nie zawiera materiałów MEGA ani innych kursów.

## Uruchomienie

Wymagany Node.js >= 22.18.

```sh
npm run setup
npm start
```

Otwórz http://localhost:4830. Inny port: `PORT=4831 npm start`.

Nowa instalacja uruchamia się z pustą biblioteką. Integracja z MEGA pozwala zalogować się i importować dostępne na własnym koncie lekcje. Import wymaga przeglądarki (`npm run setup:import`), ffmpeg i środowiska Python `.audio-venv` z pakietami używanymi przez `study/import-alignment.py`.

## Lokalne dane i udostępnianie

Materiały są zapisywane w `.study-data/` wewnątrz katalogu projektu. Cały ten katalog jest wykluczony przez `.gitignore`: artykuły, zdjęcia, nagrania, transkrypcje, sesje, profil przeglądarki, ćwiczenia, kopie robocze i zrzuty testowe nie trafiają do Gita.

Każdy uczestnik klonuje samą platformę, wykonuje polecenia instalacji powyżej, loguje się na własne konto MEGA. Po połączeniu aplikacja automatycznie sprawdza cały katalog i pobiera wszystkie dostępne lekcje — nie trzeba wklejać linków pojedynczo. Przy ponownym otwarciu sprawdza dostępność jeszcze raz, pomija gotowe materiały i wznawia niedokończone pobieranie. Przycisk „Check for new lessons / retry downloads” uruchamia sprawdzenie również bez restartu. Nowa instalacja nie zawiera gotowych materiałów ani cudzej sesji. Dostęp do materiałów przez aplikację wymaga sesji MEGA.

Katalog `.study-data/` zawiera:

- `study/`: lokalny katalog kursu, artykuły, ilustracje, audio i mapy synchronizacji.
- `.mega-study/`: sesję, profil przeglądarki, stan importów i pobrane ćwiczenia.
- `course-examples/`: opcjonalną instalację wcześniejszych ćwiczeń; platforma działa również bez niej.
- `.audit/`: zrzuty ekranu i ślady lokalnej weryfikacji.

`STUDY_DATA_HOME` pozwala wybrać katalog poza projektem. W projekcie dane można zapisywać wyłącznie pod `.study-data/`. Klucze API zapisują się w ignorowanym `.env`; testy mogą wskazać osobny plik przez `MEX_ENV_FILE`. Notatki i postęp pozostają w localStorage przeglądarki.

Udostępniaj projekt przez repozytorium Git lub archiwum utworzone przez `git archive`, które zawiera tylko pliki zatwierdzone w Gicie. Nie wysyłaj ZIP-a całego katalogu roboczego — taki ZIP zawierałby również lokalne materiały. `.gitignore` nie usuwa plików, które były wcześniej śledzone; `npm run audit:content` wykrywa również takie przypadki.

Przed pierwszą publikacją uruchom audyt i przejrzyj `git diff --cached`. Workflow GitHub Actions uruchamia audyt i testy przy pushu oraz pull requeście. Testy używają wyłącznie sztucznych danych.

Pobieranie i przygotowanie odbywa się kolejno, w tle. Pozostaw serwer uruchomiony; zamknięcie panelu nie zatrzymuje kolejki. Błędy poszczególnych lekcji są widoczne w panelu i nie blokują pozostałych. Wygaśnięcie sesji zatrzymuje synchronizację do ponownego zalogowania. Nieopublikowane lekcje są pomijane.

## Przygotowanie importu

Czytnik i pusta platforma wymagają tylko Node.js. Pobieranie i przygotowanie lekcji wymaga dodatkowo Chromium, `ffmpeg` w PATH oraz środowiska Python:

```sh
npm run setup:import
python3 -m venv .audio-venv
.audio-venv/bin/python -m pip install stable-ts mlx-whisper
```

Obecny moduł synchronizacji audio korzysta z MLX i jest przeznaczony dla macOS z Apple Silicon. Importu audio na Windows/Linux nie zweryfikowano; wymaga on innego silnika transkrypcji. Nie jest to warunek uruchomienia samej platformy.

## Weryfikacja

```sh
npm test
npm run audit:content
python3 -m unittest discover -s study -p 'test_*.py'
```

Audyt sprawdza pliki śledzone przez Git oraz nieignorowane pliki, które można dodać. Lokalna zawartość `.study-data/` jest dozwolona. Materiały, media, archiwa, binaria i dowiązania wśród plików do publikacji powodują błąd. Nie rozstrzyga automatycznie pochodzenia każdego zdania; zmiany tekstowe wymagają przeglądu. Zależności, środowisko Python i narzędzia pstack nie są materiałami kursu i są wyłączone z tego testu.

Pełna weryfikacja istniejącej prywatnej biblioteki wymaga lokalnych materiałów pierwszych dwóch lekcji i instalacji ćwiczeń w `.study-data/`:

```sh
BROWSER_CHANNEL=chrome .agents/skills/verify/scripts/verify.mjs
```

Skill `verify` opisuje zakres tej próby. Używa izolowanej sesji i zastępuje wyłącznie zewnętrzne uwierzytelnianie; nie wykonuje płatnych wywołań modeli. Dowody zapisuje w ignorowanym `.study-data/.audit/`.
