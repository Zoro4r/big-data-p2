"""Pruebas de la decisión de fuente de la capa por lotes: MongoDB o EventStreams."""

from datetime import datetime, timedelta, timezone

from wikipipe.fuente import MARGEN, decidir

INICIO = datetime(2026, 11, 13, 10, tzinfo=timezone.utc)
FIN = INICIO + timedelta(hours=1)


def tramo(inicio, fin, actualizado=None):
    return {"_id": "t", "inicio": inicio, "fin": fin, "actualizado": actualizado or fin}


def test_hora_cubierta_con_margen_se_lee_de_mongodb():
    t = tramo(INICIO - timedelta(hours=3), FIN + MARGEN)
    assert decidir(t, INICIO, FIN, FIN + MARGEN) == "mongodb"


def test_sin_tramo_o_con_hueco_se_usa_eventstreams():
    assert decidir(None, INICIO, FIN, FIN) == "eventstreams"
    # El tramo empezó después del inicio de la hora: faltan los primeros minutos.
    assert decidir(tramo(INICIO + timedelta(minutes=2), FIN + MARGEN), INICIO, FIN, FIN) == "eventstreams"
    # El tramo terminó antes de que empezara la hora.
    assert decidir(tramo(INICIO - timedelta(hours=3), INICIO - timedelta(minutes=1)), INICIO, FIN, FIN) == "eventstreams"


def test_si_el_stream_todavia_no_llega_al_margen_se_espera():
    ahora = FIN + timedelta(seconds=30)
    t = tramo(INICIO - timedelta(hours=3), FIN + timedelta(seconds=29), actualizado=ahora)
    assert decidir(t, INICIO, FIN, ahora) == "esperar"


def test_si_el_stream_se_detuvo_no_se_espera():
    # Cubre el inicio pero no avanza desde hace 10 minutos: el servicio está caído.
    ahora = FIN + timedelta(minutes=10)
    t = tramo(INICIO - timedelta(hours=3), INICIO + timedelta(minutes=40), actualizado=ahora - timedelta(minutes=10))
    assert decidir(t, INICIO, FIN, ahora) == "eventstreams"
