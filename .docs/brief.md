# Liora CamWard — Detector de Cámaras Ocultas

- One-line positioning: Web app (PWA) que combina técnicas reales de escaneo (WiFi/Bluetooth, óptico, puertos de red, magnetómetro) para ayudar a detectar cámaras y dispositivos de espionaje ocultos, con reportes reales, multi-idioma y plan premium.
- Target users: Viajeros, huéspedes de Airbnb/hoteles, personas preocupadas por su privacidad en espacios alquilados o de trabajo.
- Core features:
  1. Escaneo real combinado: red WiFi/Bluetooth cercana (Web Bluetooth + análisis de red), detección óptica de lentes por reflejo con cámara+flash, magnetómetro (Sensor API) como dato orientativo. Sin datos aleatorios ni falsos positivos simulados: solo se reporta lo detectado por el dispositivo.
  2. Reportes reales por sesión de escaneo: hallazgos con evidencia (captura, intensidad de señal, tipo de dispositivo), guardados en base de datos, exportables/histórico.
  3. Selector de idioma (ES/EN/PT/FR) persistente.
- Important features (P1):
  1. Plan Premium (Stripe) con escaneos ilimitados, histórico extendido e informes PDF.
  2. Panel de administrador (creador) protegido: genera y controla 50 códigos premium de por vida canjeables una vez.
  3. Aviso legal claro de límites técnicos del escaneo (no es garantía absoluta).
- Device strategy: adaptive (uso principal en móvil vía navegador, PWA instalable; APIs sensor/cámara solo disponibles en el dispositivo del usuario).
- Design style: Serio, tipo "seguridad/tecnológico", oscuro con acentos cian/verde de radar, confiable, no genérico.
- Technical constraints: Web Bluetooth/Sensor API solo funcionan en navegadores compatibles (Chrome Android); en iOS Safari se degradan a escaneo óptico + red. Empaquetado final a tiendas vía Capacitor fuera de este entorno.
- Nova Agent: not needed
- Completed: brief creado
- Current iteration: modelo de datos, motor de escaneo, reportes, auth admin, idiomas, premium
