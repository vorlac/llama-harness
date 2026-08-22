; case gc-008-concatempty
; expect exit=0 stdout="1\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR ""
  CONCAT
  GCLIVE
  PRINT
  RET
.end
