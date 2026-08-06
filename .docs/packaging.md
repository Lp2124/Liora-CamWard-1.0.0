# Liora CamWard — Empaquetado a App Store / Google Play

Liora CamWard ya es una **PWA instalable** (manifest + iconos + service-worker-ready). Para
publicarla como app nativa en las tiendas, el camino recomendado es **Capacitor**,
ejecutado **fuera de este entorno** (necesita Xcode / Android Studio en tu propia
máquina o una Mac en la nube).

## 1. Requisitos previos (fuera de este entorno)

- Cuenta Apple Developer (99 USD/año) para App Store.
- Cuenta Google Play Console (25 USD pago único) para Google Play.
- Mac con Xcode (solo para iOS) y Android Studio (para Android).
- Node.js instalado localmente.

## 2. Pasos generales

1. Clona/descarga este proyecto en tu máquina local.
2. `pnpm build` para generar la versión de producción.
3. Instala Capacitor: `pnpm add @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`.
4. `npx cap init "Liora CamWard" "com.tuempresa.lioracamward"`.
5. Como Next.js usa SSR (no export estático), Capacitor debe apuntar a la **URL pública
   desplegada** de Liora CamWard (no a archivos locales): configura `server.url` en
   `capacitor.config.json` con el dominio ya publicado de la app, y `server.androidScheme: "https"`.
6. `npx cap add ios` y `npx cap add android`.
7. Declara permisos nativos reales (la app los pedirá igualmente en runtime):
   - **iOS** (`Info.plist`): `NSCameraUsageDescription`, `NSBluetoothAlwaysUsageDescription`,
     `NSLocationWhenInUseUsageDescription` (requerido por iOS para Bluetooth de bajo consumo).
   - **Android** (`AndroidManifest.xml`): `CAMERA`, `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`,
     `ACCESS_FINE_LOCATION` (requerido por Android para escaneo Bluetooth).
8. `npx cap open ios` / `npx cap open android` y compila desde cada IDE.
9. Sube el build firmado a App Store Connect / Google Play Console.

## 3. Limitaciones a declarar en la ficha de la tienda

- El magnetómetro y Web Bluetooth **no funcionan en Safari/iOS** (limitación de Apple).
  En iPhone, Liora CamWard funciona con el módulo óptico y de red; en Android con Chrome
  funcionan los 4 módulos.
- Liora CamWard **no garantiza** detectar el 100% de dispositivos ocultos: es una
  herramienta de apoyo, no una garantía de seguridad (esto ya está en el aviso legal
  dentro de la app).

## 4. Antes de publicar

- Configura las claves reales de Stripe en producción (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`, `STRIPE_PREMIUM_PRICE_ID`) si vas a vender Premium por
  tarjeta.
- Define `ADMIN_EMAIL` con tu correo de Google para tener acceso de administrador y
  premium de por vida automáticamente al iniciar sesión.
- Revisa la política de privacidad exigida por ambas tiendas (uso de cámara/Bluetooth
  debe estar descrito).
