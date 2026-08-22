; case strops-055-chrord
; expect exit=0 stdout="97\n"
.func main arity=0 locals=0
  PUSH_INT 97
  CHR
  ORD
  PRINT
  RET
.end
