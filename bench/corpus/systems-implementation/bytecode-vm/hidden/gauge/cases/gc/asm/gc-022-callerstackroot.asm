; case gc-022-callerstackroot
; expect exit=0 stdout="2\n"
.func main arity=0 locals=0
  NEW_ARRAY 0
  CLOSURE probe
  CALL 0
  PRINT
  POP
  RET
.end
.func probe arity=0 locals=0
  GCLIVE
  RET
.end
