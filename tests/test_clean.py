"""Pruebas de las reglas de limpieza con comentarios reales vistos en enwiki y eswiki."""

from wikipipe.clean import derive, user_type, validate


def make(**kw):
    base = {
        "meta": {"id": "abc", "dt": "2026-10-31T16:58:00.046Z", "domain": "en.wikipedia.org"},
        "type": "edit", "wiki": "enwiki", "title": "Página", "namespace": 0,
        "user": "Editor1", "bot": False, "timestamp": 1793462280, "comment": "",
        "length": {"old": 100, "new": 150},
    }
    base.update(kw)
    return base


def test_user_types():
    assert user_type(make(bot=True)) == "bot"
    assert user_type(make(user="~2026-58210-47")) == "temporal"
    assert user_type(make(user="192.168.0.1")) == "ip"
    assert user_type(make(user="Juan")) == "registrado"
    # Bots sin la marca bot=True en el evento
    assert user_type(make(user="ClueBot NG")) == "bot"
    assert user_type(make(user="AnomieBOT")) == "bot"
    # Cuentas automáticas conocidas, sin marca ni «bot» en el nombre
    assert user_type(make(user="Automoderador")) == "bot"
    assert user_type(make(user="Abbott")) == "registrado"


def test_validate():
    assert validate(make()) is None
    assert validate(make(meta={"id": "x", "dt": "2026-10-31T00:00:00Z", "domain": "canary"})) == "canary"
    assert validate(make(user="")) == "falta_user"
    assert validate(make(type="otro")) == "tipo_desconocido"


def test_delta_and_time():
    d = derive(make())
    assert d["delta_bytes"] == 50
    assert d["date"] == "2026-10-31" and d["hour"] == 16
    assert d["page_key"] == "enwiki:Página"


def test_revert_english_and_spanish():
    en = "Undid revision [[Special:Diff/1|1]] by [[Special:Contributions/AimiqaXerni|AimiqaXerni]] ([[User talk:AimiqaXerni|talk]])"
    assert derive(make(comment=en))["revert_target"] == "AimiqaXerni"
    contribs = "Reverted edit by [[Special:Contribs/~2026-51929-66|~2026-51929-66]] to last version by X"
    assert derive(make(comment=contribs))["revert_target"] == "~2026-51929-66"
    es = "Deshecha la [[Especial:Diff/176084331|edición 176084331]] de [[Especial:Contribuciones/~2026-58210-47|~2026-58210-47]]"
    assert derive(make(comment=es, wiki="eswiki"))["revert_target"] == "~2026-58210-47"


def test_not_revert():
    warning = "Warning [[Special:Contributions/~2026-57795-91|~2026-57795-91]] - #3"
    assert "revert_target" not in derive(make(comment=warning))
    restored = "Restored revision 1 by [[Special:Contributions/GrinningIodize|GrinningIodize]]"
    assert "revert_target" not in derive(make(comment=restored))
    self_revert = "Undid revision 1 by [[Special:Contributions/Editor1|Editor1]]"
    assert "revert_target" not in derive(make(comment=self_revert))


def test_message_target():
    d = derive(make(namespace=3, title="User talk:Chromenano"))
    assert d["message_target"] == "Chromenano"
    d = derive(make(namespace=3, title="Usuario discusión:Juan/Archivo", wiki="eswiki"))
    assert d["message_target"] == "Juan"


def test_categorize():
    en = make(type="categorize", title="Category:Articles with missing files",
              comment="[[:2026 United States gubernatorial elections]] removed from category, [[Special:WhatLinksHere/x|...]]")
    d = derive(en)
    assert d["categorized_page"] == "2026 United States gubernatorial elections"
    assert d["category_action"] == "removed"
    es = make(type="categorize", wiki="eswiki", title="Categoría:Wikiproyecto:México/Artículos",
              comment="[[:Discusión:Gran desfile de Día de muertos]] añadida a la categoría")
    assert derive(es)["category_action"] == "added"


def test_logs():
    block = make(type="log", log_type="block", log_action="block", title="User:Wiki2323121",
                 log_params={"duration": "infinity"})
    assert derive(block)["block_target"] == "Wiki2323121"
    move = make(type="log", log_type="move", log_action="move", title="Tony Edwards",
                log_params={"target": "Tony Edwards (cartoonist)"})
    assert derive(move)["move_target"] == "Tony Edwards (cartoonist)"
    thanks = make(type="log", log_type="thanks", log_action="thank", title="User:Ana", log_params=[])
    assert derive(thanks)["thanks_target"] == "Ana"
