; case strops-038-indexof
; expect exit=0 stdout="0\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR ""
  INDEXOF
  PRINT
  RET
.end
