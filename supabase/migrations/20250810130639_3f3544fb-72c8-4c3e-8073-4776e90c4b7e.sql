CREATE OR REPLACE FUNCTION public.auto_match_documents_function(trial_balance_id_param uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    total_assignments INTEGER;
    matched_count INTEGER;
    assignment_record RECORD;
    document_record RECORD;
    trial_balance_record RECORD;
    parsed_accounts JSONB;
    account_item JSONB;
    result JSON;
    has_groups BOOLEAN;
BEGIN
    -- Setze einen sicheren search_path
    SET search_path = public;
    
    -- Prüfe ob Gruppen existieren
    SELECT COUNT(*) > 0 INTO has_groups
    FROM account_groups 
    WHERE trial_balance_id = trial_balance_id_param;
    
    matched_count := 0;
    
    IF has_groups THEN
        -- Bestehende Logik für gruppierte Accounts
        SELECT COUNT(*) INTO total_assignments
        FROM account_group_assignments aga
        JOIN account_groups ag ON aga.account_group_id = ag.id
        WHERE ag.trial_balance_id = trial_balance_id_param;
        
        -- Für jedes Assignment, suche nach passenden Dokumenten
        FOR assignment_record IN
            SELECT aga.id, aga.account_number, aga.account_name, aga.current_year_balance
            FROM account_group_assignments aga
            JOIN account_groups ag ON aga.account_group_id = ag.id
            WHERE ag.trial_balance_id = trial_balance_id_param
        LOOP
            -- Einfaches Matching: Suche nach Dokumenten, die die Kontonummer im Namen enthalten
            FOR document_record IN
                SELECT ae.id, ae.file_name
                FROM account_evidence ae
                WHERE ae.trial_balance_id = trial_balance_id_param
                AND (
                    UPPER(ae.file_name) LIKE '%' || assignment_record.account_number || '%'
                    OR UPPER(ae.file_name) LIKE '%' || UPPER(assignment_record.account_name) || '%'
                )
            LOOP
                -- Update Assignment mit Match
                UPDATE account_group_assignments
                SET 
                    match_status = 'matched',
                    confidence_score = 0.8,
                    matched_documents = array_append(COALESCE(matched_documents, ARRAY[]::uuid[]), document_record.id)
                WHERE id = assignment_record.id;
                
                matched_count := matched_count + 1;
                EXIT; -- Nur ein Dokument pro Assignment für jetzt
            END LOOP;
            
            -- Wenn kein Match gefunden wurde, setze auf unmatched
            UPDATE account_group_assignments
            SET match_status = 'unmatched'
            WHERE id = assignment_record.id
            AND match_status IS NULL;
        END LOOP;
    ELSE
        -- Neue Logik für ungrouped accounts: Lade trial balance direkt
        -- Hier erstellen wir temporäre "assignments" aus der trial balance
        -- und matchen diese gegen die Dokumente
        
        -- Hole trial balance Metadaten (vereinfacht für Demo)
        -- In einer echten Implementierung würde hier die Excel-Datei geparst werden
        -- Für jetzt nehmen wir an, dass die account_evidence file_name pattern matching verwendet
        
        SELECT COUNT(*) INTO total_assignments
        FROM account_evidence
        WHERE trial_balance_id = trial_balance_id_param;
        
        -- Vereinfachter Ansatz: Erstelle virtuelle matches basierend auf Dateinamen
        FOR document_record IN
            SELECT ae.id, ae.file_name
            FROM account_evidence ae
            WHERE ae.trial_balance_id = trial_balance_id_param
        LOOP
            -- Extrahiere mögliche Kontonummer aus Dateiname (vereinfacht)
            -- Dies könnte erweitert werden um komplexere Pattern zu erkennen
            IF document_record.file_name ~ '^[0-9]{3,4}[^0-9]' THEN
                matched_count := matched_count + 1;
            END IF;
        END LOOP;
    END IF;
    
    result := json_build_object(
        'total_assignments', total_assignments,
        'matched_count', matched_count,
        'success', true,
        'has_groups', has_groups
    );
    
    RETURN result;
END;
$function$