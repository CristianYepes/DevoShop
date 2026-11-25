# Cloud Run para DevoShop: qué importa y cómo desplegar

> Investigado el 25-11-2026 con la documentación oficial de Cloud Run (enlaces al final). **[medir]** = lo dice la teoría, pero no se ha medido en nuestro servicio.

## 1. Hechos de Cloud Run que nos afectan

| Hecho (documentación oficial) | Consecuencia para DevoShop |
|---|---|
| **Facturación por petición (la de por defecto):** solo hay CPU **mientras se atiende una petición**. Con `--no-cpu-throttling` (facturación por instancia) la CPU está siempre | Los procesos de fondo de Postgres (checkpoint, autovacuum) apenas tienen CPU entre peticiones. Para un catálogo de solo lectura no importa; para escribir pedidos, sí **[medir]** |
| **Gen1 (gVisor)** emula "la mayoría, pero no todas" las llamadas al sistema y arranca rápido. **Gen2 (microVM)** es Linux completo, necesita **≥ 512 MiB** y puede tardar más en arrancar en frío | Postgres depende mucho de la memoria compartida. **Con Postgres dentro, usar `--execution-environment gen2`** para no arriesgarse a una llamada no soportada **[medir]**. Sin Postgres, gen1 está bien |
| El disco del contenedor está **en memoria**: lo que se escribe ocupa RAM (confirmado para los volúmenes en memoria; para el sistema de ficheros base no lo he podido confirmar) | `PGDATA` (initdb + datos) **resta memoria** a Node. Con Postgres, poner `--memory 1Gi` |
| **Sondas de arranque:** por defecto, periodo de 10 s, 3 fallos y 1 s de timeout (unos 30 s), con un máximo configurable de 240 s | El entrypoint espera hasta 30 s a que arranque Postgres (`pg_ctl -t 30`) **antes** de lanzar Node. Si tarda más, la instancia falla |
| **Cada instancia nueva arranca de cero** (el entrypoint ejecuta `initdb` y carga `init.sql` cada vez) | El arranque en frío incluye Postgres: **perjudica al tiempo de respuesta** (mediana ≤ 200 ms) y al **Black Friday** si Cloud Run levanta instancias nuevas a mitad de prueba **[medir]** |
| Las instancias **no comparten disco** | Un carrito o un pedido guardado en el Postgres de una instancia no existe en las demás. **El carrito no puede ir en Postgres** (va en una cookie firmada) |
| Máximo de instancias: **100 por defecto**. Concurrencia: **80 × vCPU** con gcloud, hasta **1000**. Si no hay instancia libre en 10 s → **429** | Un 429 en Black Friday cuenta como fallo. Subir la concurrencia y dejar margen de instancias |
| Instancias mínimas: eliminan el arranque en frío de 0 a 1, pero se cobran aunque no haya tráfico | `--min-instances 1` **solo** durante las ventanas de evaluación |
| CPU boost: más CPU al arrancar y 10 s después | Ayuda a que `initdb` + carga + Node arranquen antes |
| **europe-southwest1 (Madrid) es región de nivel 1** de precios | Es la que pide la guía y la más barata |

## 2. Comandos de despliegue

### Con el `main` actual (Postgres dentro del contenedor)
```bash
gcloud run deploy devoshop --source . --region europe-southwest1 --allow-unauthenticated \
  --execution-environment gen2 --memory 1Gi --cpu 1 \
  --concurrency 250 --max-instances 3 --cpu-boost
```

### Si quitamos Postgres del arranque (catálogo en memoria)
```bash
gcloud run deploy devoshop --source . --region europe-southwest1 --allow-unauthenticated \
  --memory 512Mi --cpu 1 --concurrency 250 --max-instances 3 --cpu-boost
```

### Ventanas de evaluación (hitos, evaluación general y pruebas del agente)
```bash
gcloud run services update devoshop --region europe-southwest1 --min-instances 1   # antes
gcloud run services update devoshop --region europe-southwest1 --min-instances 0   # después
```

## 3. Medir antes de gastar un intento (Cloud Shell)
```bash
URL=$(gcloud run services describe devoshop --region europe-southwest1 --format='value(status.url)')

# 1) ¿Es pública y responde? Tiene que dar 200
curl -s -o /dev/null -w "%{http_code}\n" $URL

# 2) Cabeceras de seguridad y cookie
curl -sI $URL | grep -iE 'strict|nosniff|content-security|set-cookie|server|powered'

# 3) Tiempo de respuesta: 20 peticiones seguidas, ordenadas (la mediana es la 10.ª-11.ª y el p95 la 19.ª)
for i in $(seq 20); do curl -o /dev/null -s -w "%{time_total}\n" $URL; done | sort -n

# 4) Arranque en frío: forzar una instancia nueva y medir la primera petición
gcloud run services update devoshop --region europe-southwest1 --update-env-vars COLD=$(date +%s)
time curl -s -o /dev/null $URL

# 5) Registros (errores de arranque, Postgres)
gcloud run services logs read devoshop --region europe-southwest1 --limit 50
```
**Comprobar el instrumento:** `curl -s -o /dev/null -w "%{http_code}\n" $URL/no-existe` tiene que dar 404. Si da 200, estamos midiendo otra cosa.

## 4. Fuentes
- Facturación por petición o por instancia: https://docs.cloud.google.com/run/docs/configuring/billing-settings
- Coste: https://docs.cloud.google.com/run/docs/tips/services-cost-optimization
- Entornos de ejecución gen1 y gen2: https://docs.cloud.google.com/run/docs/about-execution-environments
- Volúmenes en memoria: https://docs.cloud.google.com/run/docs/configuring/in-memory-volumes
- Sondas de estado: https://docs.cloud.google.com/run/docs/configuring/healthchecks
- Instancias máximas: https://docs.cloud.google.com/run/docs/configuring/max-instances · límites y 429: https://docs.cloud.google.com/run/docs/configuring/max-instances-limits
- Concurrencia: https://docs.cloud.google.com/run/docs/about-concurrency
- CPU boost: https://docs.cloud.google.com/run/docs/configuring/cpu
- Instancias mínimas: https://docs.cloud.google.com/run/docs/configuring/min-instances
- Regiones y niveles de precio: https://docs.cloud.google.com/run/docs/locations
- Precios: https://cloud.google.com/run/pricing
