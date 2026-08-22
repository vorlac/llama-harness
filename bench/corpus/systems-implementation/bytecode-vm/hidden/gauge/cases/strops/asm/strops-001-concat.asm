; case strops-001-concat
; expect exit=0 stdout="\n"
.func main arity=0 locals=0
  PUSH_STR ""
  PUSH_STR ""
  CONCAT
  PRINT
  RET
.end
