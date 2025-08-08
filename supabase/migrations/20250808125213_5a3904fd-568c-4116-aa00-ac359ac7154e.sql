-- Fix the matched_documents column to be UUID array instead of text array
ALTER TABLE account_group_assignments 
ALTER COLUMN matched_documents TYPE uuid[] USING matched_documents::uuid[];

-- Update the database function to work with the corrected column type
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
    result JSON;
BEGIN
    -- Setze einen sicheren search_path
    SET search_path = public;
    
    -- Hole alle Assignments für diese trial_balance_id
    SELECT COUNT(*) INTO total_assignments
    FROM account_group_assignments aga
    JOIN account_groups ag ON aga.account_group_id = ag.id
    WHERE ag.trial_balance_id = trial_balance_id_param;
    
    matched_count := 0;
    
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
            -- Update Assignment mit Match - now using proper UUID array
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
    
    result := json_build_object(
        'total_assignments', total_assignments,
        'matched_count', matched_count,
        'success', true
    );
    
    RETURN result;
END;
$function$;