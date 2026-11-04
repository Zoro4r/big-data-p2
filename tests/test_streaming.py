"""Pruebas de la capa rápida: filtro de eventos y contadores por minuto."""

from wikipipe.streaming import Contadores, preparar


def evento(**kw):
    base = {
        "meta": {"id": "id-1", "dt": "2026-11-04T01:30:15Z", "domain": "en.wikipedia.org"},
        "type": "edit", "wiki": "enwiki", "title": "Página", "namespace": 0,
        "user": "Editor1", "bot": False, "timestamp": 1, "comment": "", "length": {"old": 10, "new": 20},
    }
    base.update(kw)
    return base


def test_preparar_filtra_y_enriquece():
    e = preparar(evento())
    assert e["_id"] == "id-1" and e["derived"]["minute"] == "2026-11-04T01:30"
    assert preparar(evento(wiki="frwiki")) is None                      # wiki fuera del alcance
    assert preparar(evento(meta={"id": "x", "dt": "2026-11-04T01:30:00Z", "domain": "canary"})) is None
    assert preparar(evento(user="")) is None                             # no pasa la validación


def test_contadores_por_minuto():
    c = Contadores()
    c.sumar(preparar(evento()))
    c.sumar(preparar(evento(meta={"id": "id-2", "dt": "2026-11-04T01:30:40Z"}, user="ClueBot NG",
                            comment="Reverting edits by [[Special:Contributions/Juan|Juan]]")))
    c.sumar(preparar(evento(meta={"id": "id-3", "dt": "2026-11-04T01:31:05Z"}, type="log")))
    filas = c.filas_para_escribir()
    assert len(filas) == 2
    wiki, _, minuto, eventos, ediciones, bots, reversiones = filas[0]
    assert (wiki, minuto.minute, eventos, ediciones, bots, reversiones) == ("enwiki", 30, 2, 2, 1, 1)
    assert filas[1][3:] == (1, 0, 0, 0)  # el evento log cuenta como evento, no como edición
    assert c.filas_para_escribir() == []  # solo se reescriben los minutos que cambiaron
