DO $$ DECLARE def text;old text:='end if;
    if v_section = ''listing'' then';new text:='v_state := v_state - ''appraisal'';
    end if;
    if v_section = ''listing'' then'; BEGIN def:=pg_get_functiondef('public.gw_apply_internal(bigint,text)'::regprocedure); IF position(old IN def)=0 THEN RAISE EXCEPTION 'safe appraisal merge anchor missing';END IF; EXECUTE replace(def,old,new);END $$;